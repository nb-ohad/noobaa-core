/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const child_process = require('child_process');

const P = require('./promise');
const util = require('util');
const dbg = require('../util/debug_module')(__filename);
const Semaphore = require('./semaphore');

require('setimmediate');

const delay = util.promisify(setTimeout);

/**
 *
 */
function join(obj, property, func) {
    var promise = obj[property];
    if (promise) {
        return promise;
    }
    promise = P.try(func)
        .finally(() => {
            delete obj[property];
        });
    obj[property] = promise;
    return promise;
}

/**
 *
 * Iterate on an array, accumulate promises and return results of each
 * invocation
 *
 */
function iterate(array, func) {
    var i = -1;
    var results = [];
    if (!array || !array.length) {
        return P.resolve(results);
    }
    results.length = array.length;

    function next(res) {

        // save the result of last iteration (unless it's the initial call)
        if (i >= 0) {
            results[i] = res;
        }

        // incrementing - notice that i starts from -1 so we increment before
        // in order to avoid creating a callback per iteration
        i += 1;

        // when finished, make sure to set length so that if array got truncated
        // during iteration then also results will have same length
        if (i >= array.length) {
            results.length = array.length;
            return;
        }

        // call func as function(item, index, array)
        return Promise.resolve().then(() => func(array[i], i, array)).then(next);
    }

    return Promise.resolve().then(next).then(() => results);
}



/**
 *
 * simple promise loop, similar to _.times but ignores the return values,
 * and only returns a promise for completion or failure
 *
 */
function loop(times, func) {
    // wrap in P.resolve to return a bluebird promise
    return P.resolve()
        .then(async () => {
            for (let i = 0; i < times; ++i) {
                await func(i);
            }
        });
}

// implementation of pwhile using async/await
function pwhile(condition, body) {
    // wrap in P.resolve to return a bluebird promise
    return P.resolve()
        .then(async () => {
            while (condition()) {
                await body();
            }
        });
}

/**
 *
 * simple promise loop, similar to _.times but ignores the return values,
 * and only returns a promise for completion or failure
 *
 * @param {number} attempts number of attempts. can be Infinity.
 * @param {number} delay_ms number of milliseconds between retries
 * @param {(attemtpts:number) => Promise} func passing remaining attempts just fyi
 * @param {(err:Error) => void} [error_logger]
 */
function retry(attempts, delay_ms, func, error_logger) {

    // call func and catch errors,
    // passing remaining attempts just fyi
    return P.try(() => func(attempts))
        .catch(err => {

            // check attempts
            attempts -= 1;
            if (attempts <= 0 || err.DO_NOT_RETRY) {
                throw err;
            }

            if (error_logger) {
                error_logger(err);
            }

            // delay and retry next attempt
            return delay(delay_ms)
                .then(() => retry(attempts, delay_ms, func, error_logger));
        });
}


/**
 * promise version of setImmediate, or P.delay
 * using unref() so that the promise will not block the event loop from exiting
 * in case there are no other events waiting.
 * see http://nodejs.org/api/timers.html#timers_unref
 */
function delay_unblocking(delay_ms) {
    return new P((resolve, reject, on_cancel) => {
        const timer = setTimeout(resolve, delay_ms);
        if (timer.unref) timer.unref();
        if (on_cancel) on_cancel(() => clearTimeout(timer));
    });
}

/**
 * promise version of setImmediate
 * which will be resolved on the next event loop
 */
function set_immediate() {
    return new P((resolve, reject, on_cancel) => {
        const timer = setImmediate(resolve);
        if (on_cancel) {
            on_cancel(() => clearImmediate(timer));
        }
    });
}

/**
 * promise version of process.nextTick
 * which will be resolved before handling I/O completions
 */
function next_tick() {
    return new P((resolve, reject) => {
        process.nextTick(resolve);
    });
}


// for the sake of tests to be able to exit we schedule the worker with unblocking delay
// so that it won't prevent the process from existing if it's the only timer left
function run_background_worker(worker) {
    const DEFAULT_DELAY = 10000;

    function run() {
        P.try(() => worker.run_batch())
            .then(delay_ms => delay_unblocking(delay_ms || worker.delay || DEFAULT_DELAY), err => {
                dbg.log('run_background_worker', worker.name, 'UNCAUGHT ERROR', err, err.stack);
                return delay_unblocking(worker.delay || DEFAULT_DELAY);
            })
            .then(run);
    }
    dbg.log('run_background_worker:', 'INIT', worker.name);
    delay_unblocking(worker.boot_delay || worker.delay || DEFAULT_DELAY).then(run);
    return worker;
}

/*
 * Run child process spawn wrapped by a promise
 */
function spawn(command, args, options, ignore_rc, unref, timeout_ms) {
    return new P((resolve, reject) => {
        options = options || {};
        args = args || [];
        dbg.log0('spawn:', command, args.join(' '), options, ignore_rc);
        options.stdio = options.stdio || 'inherit';
        var proc = child_process.spawn(command, args, options);
        proc.on('exit', code => {
            if (code === 0 || ignore_rc) {
                resolve();
            } else {
                reject(new Error('spawn "' +
                    command + ' ' + args.join(' ') +
                    '" exit with error code ' + code));
            }
        });
        proc.on('error', error => {
            if (ignore_rc) {
                dbg.warn('spawn ' +
                    command + ' ' + args.join(' ') +
                    ' exited with error ' + error +
                    ' and ignored');
                resolve();
            } else {
                reject(new Error('spawn ' +
                    command + ' ' + args.join(' ') +
                    ' exited with error ' + error));
            }
        });
        if (timeout_ms) {
            setTimeout(() => {
                const pid = proc.pid;
                proc.kill();
                reject(new Error(`Timeout: Execution of ${command + args.join(' ')} took longer than ${timeout} ms. killed process (${pid})`));
            }, timeout_ms);
        }
        if (unref) proc.unref();
    });
}

/*
 * Run a node child process spawn wrapped by a promise
 */
function fork(command, input_args, opts, ignore_rc) {
    return new P((resolve, reject) => {
        let options = opts || {};
        let args = input_args || [];
        dbg.log0('fork:', command, args.join(' '), options, ignore_rc);
        options.stdio = options.stdio || 'inherit';
        var proc = child_process.fork(command, args, options);
        proc.on('exit', code => {
            if (code === 0 || ignore_rc) {
                resolve();
            } else {
                const err = new Error('fork "' +
                    command + ' ' + args.join(' ') +
                    '" exit with error code ' + code);
                err.code = code;
                reject(err);
            }
        });
        proc.on('error', error => {
            if (ignore_rc) {
                dbg.warn('fork ' +
                    command + ' ' + args.join(' ') +
                    ' exited with error ' + error +
                    ' and ignored');
                resolve();
            } else {
                reject(new Error('fork ' +
                    command + ' ' + args.join(' ') +
                    ' exited with error ' + error));
            }
        });
    });
}

function exec(command, options) {
    const ignore_rc = (options && options.ignore_rc) || false;
    const return_stdout = (options && options.return_stdout) || false;
    const timeout_ms = (options && options.timeout) || 0;
    const trim_stdout = (options && options.trim_stdout) || false;
    return new P((resolve, reject) => {
        dbg.log2('promise exec', command, ignore_rc);
        child_process.exec(command, {
            maxBuffer: 5000 * 1024, //5MB, should be enough
            timeout: timeout_ms
        }, function(error, stdout, stderr) {
            if (!error || ignore_rc) {
                if (error) {
                    dbg.warn(command + " exited with error " + error + " and ignored");
                }
                if (return_stdout) {
                    if (trim_stdout) stdout = stdout.trim();
                    resolve(stdout);
                } else {
                    resolve();
                }
            } else {
                const err = new Error(command + " exited with error " + error);
                err.stderr = stderr;
                err.stdout = stdout;
                reject(err);
            }
        });
    });
}

function wait_for_event(emitter, event, timeout_ms) {
    return new P((resolve, reject) => {
        // the first event to fire wins.
        // since we use emitter.once and the promise will not change after settling
        // then we can be lazy and leave dangling listeners
        emitter.once(event, resolve);
        if (event !== 'close') {
            emitter.once('close', () => reject(new Error('wait_for_event: closed')));
        }
        if (event !== 'error') {
            emitter.once('error', err => reject(err || new Error('wait_for_event: error')));
        }
        if (timeout_ms) {
            setTimeout(() => reject(new Error(`timedout waiting for event ${event} `)), timeout_ms);
        }
    });
}

/**
 * auto run set of tasks with dependencies as fast as possible.
 * based on async.js auto.
 * the tasks format is for example:
 *  {
 *      load1: function() { return delay(1000).resolve(1) },
 *      load2: function() { return delay(2000).resolve(2) },
 *      sum: ['load1', 'load2', function(load1, load2) { return load1 + load2 }],
 *      mult: ['load1', 'load2', function(load1, load2) { return load1 * load2 }],
 *      save: ['sum', 'mult', function(sum, mult) { console.log('sum', sum, 'mult', mult) }],
 *  }
 */
function auto(tasks) {
    var tasks_info = _.mapValues(tasks, function(func, name) {
        var deps;
        if (_.isArray(func)) {
            deps = func.slice(0, -1);
            func = func[func.length - 1];
        }
        if (!_.isFunction(func)) {
            throw new Error('task value must be a function for task:' + name);
        }
        _.each(deps, function(dep) {
            if (!tasks[dep]) {
                throw new Error('no such task dep: ' + dep + ' for task: ' + name);
            }
        });
        return {
            func: func,
            deps: deps,
            defer: P.defer()
        };
    });
    map_values(_.mapValues(tasks_info, function(task, name) {
        return P.all(_.map(task.deps, function(dep) {
                return tasks_info[dep].defer.promise;
            }))
            .then(function(results) {
                return task.func.apply(null, results);
            })
            .then(task.defer.resolve, task.defer.reject);
    }));
}

/**
 * like P.all but for objects.
 * returns new object with all values resolved, or reject if any failed.
 */
function map_values(obj, func) {
    var new_obj = {};
    func = func || ((val, key) => val);
    return P.all(_.map(obj, (val, key) => P.try(() => func(val, key))
            .then(res => {
                new_obj[key] = res;
            })
        ))
        .then(() => new_obj);
}

function conditional_timeout(cond, timeout_ms, prom) {
    if (cond) {
        return prom.timeout(timeout_ms);
    }
    return prom;
}

/*
 * A timeout util build to work nicely with asyc/await, example:
 * await timeout(async () => { ... }, 2000)
 */
function timeout(task, ms) {
    return P.resolve(task())
        .timeout(ms);
}


/*
 * Wait until an async condition is met
 *
 * @param async_cond - an async condition function with a boolean return value.
 * @param delay_ms - delay number of milliseconds between invocation of the condition.
 * @param timeout_ms.- A timeout to bail out of the loop, will throw timeout error.
 */
async function wait_until(async_cond, timeout_ms, delay_ms = 2500) {
    if (_.isUndefined(timeout_ms)) {
        let condition_met = false;
        while (!condition_met) {
            condition_met = await async_cond();
            if (!condition_met) {
                await delay(delay_ms);
            }
        }

    } else {
        return timeout(
            () => wait_until(async_cond, undefined, delay_ms),
            timeout_ms
        );
    }
}

/**
 * 
 * @param {number} concurrency 
 * @param {Array<any>} array 
 * @param {Function} func 
 */
function map_limit_concurrency(concurrency, array, func) {
    if (!_.isNumber(concurrency) || concurrency < 1) throw new Error(`map_limit_concurrency concurrency:${concurrency} not valid`);
    if (!_.isArray(array)) throw new Error(`map_limit_concurrency array:${array} not valid`);
    if (!_.isFunction(func)) throw new Error(`map_limit_concurrency function:${func} not valid`);
    const sem = new Semaphore(concurrency);
    return Promise.all(array.map(async item => sem.surround(async () => func(item))));
}

// EXPORTS
exports.delay = delay;
exports.join = join;
exports.iterate = iterate;
exports.loop = loop;
exports.retry = retry;
exports.delay_unblocking = delay_unblocking;
exports.run_background_worker = run_background_worker;
exports.next_tick = next_tick;
exports.set_immediate = set_immediate;
exports.spawn = spawn;
exports.exec = exec;
exports.wait_for_event = wait_for_event;
exports.pwhile = pwhile;
exports.auto = auto;
exports.map_values = map_values;
exports.fork = fork;
exports.conditional_timeout = conditional_timeout;
exports.timeout = timeout;
exports.wait_until = wait_until;
exports.map_limit_concurrency = map_limit_concurrency;
