// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var moment = require('moment');
var LRU = require('noobaa-util/lru');
var db = require('./db');
var rest_api = require('../util/rest_api');
var size_utils = require('../util/size_utils');
var system_api = require('../api/system_api');
var node_monitor = require('./node_monitor');


var system_server = new system_api.Server({
    // CRUD
    create_system: create_system,
    read_system: read_system,
    update_system: update_system,
    delete_system: delete_system,
    // LIST
    list_systems: list_systems,
    // LOGIN / LOGOUT
    login_system: login_system,
    logout_system: logout_system,
    // STATS
    system_stats: system_stats,
}, {
    before: before
});

module.exports = system_server;

function before(req) {
    if (!req.account) {
        var err = new Error('not logged in');
        err.status = 403;
        throw err;
    }
}


//////////
// CRUD //
//////////


function create_system(req) {
    var info = _.pick(req.rest_params, 'name');
    var system;
    return Q.fcall(
        function() {
            return db.System.create(info);
        }
    ).then(
        function(system_arg) {
            system = system_arg;
            return db.SystemPermission.create({
                system: system,
                account: req.account.id,
                is_admin: true,
            });
        }
    ).then(
        function() {
            return get_system_info(system);
        },
        function(err) {
            // TODO if a system was created and perm did not, then the system is in limbo...
            console.error('FAILED create_system', err);
            throw new Error('create system failed');
        }
    );
}

function read_system(req) {
    var system_id = req.rest_params.id;
    return Q.fcall(find_system_by_id_and_permission, req).then(get_system_info);
}

function update_system(req) {
    var info = _.pick(req.rest_params, 'name');
    return Q.fcall(
        find_system_by_id_and_permission, req, must_have_admin_permission
    ).then(
        function(system) {
            return db.System.findByIdAndUpdate(system.id, info).exec();
        }
    ).thenResolve();
}

// TODO delete should also handle all related models - permissions, buckets, nodes, etc.
function delete_system(req) {
    return Q.fcall(
        find_system_by_id_and_permission, req, must_have_admin_permission
    ).then(
        function(system) {
            return db.System.findByIdAndRemove(system.id).exec();
        }
    ).thenResolve();
}


//////////
// LIST //
//////////


function list_systems(req) {
    return Q.fcall(
        function() {
            return db.SystemPermission.find({
                account: req.account.id
            }).populate('system').exec();
        }
    ).then(
        function(permissions) {
            return _.map(permissions, function(perm) {
                return _.pick(perm.system, 'name');
            });
        },
        function(err) {
            console.error('FAILED list_systems', err);
            throw new Error('list systems failed');
        }
    );
}


////////////////////
// LOGIN / LOGOUT //
////////////////////


function login_system(req) {
    return Q.fcall(find_system_by_id_and_permission, req).then(
        function(system) {
            req.session.system_id = system.id;
        }
    );
}

function logout_system(req) {
    delete req.session.system_id;
}


///////////
// STATS //
///////////


function system_stats(req) {
    var minimum_online_heartbeat = node_monitor.get_minimum_online_heartbeat();
    var system_query = {
        system: req.session.system_id
    };
    return Q.all([
        // nodes - count, online count, allocated/used storage
        db.Node.mapReduce({
            query: system_query,
            scope: {
                // have to pass variables to map/reduce with a scope
                minimum_online_heartbeat: minimum_online_heartbeat,
            },
            map: function() {
                /* global emit */
                emit('count', 1);
                if (this.started && this.heartbeat >= minimum_online_heartbeat) {
                    emit('online', 1);
                }
                emit('alloc', this.allocated_storage);
                emit('used', this.used_storage);
            },
            reduce: size_utils.reduce_sum
        }),
        // node_vendors
        db.NodeVendor.count(system_query).exec(),
        // buckets
        db.Bucket.count(system_query).exec(),
        // objects
        db.ObjectMD.count(system_query).exec(),
        // parts
        db.ObjectPart.mapReduce({
            query: system_query,
            map: function() {
                /* global emit */
                emit('size', this.end - this.start);
            },
            reduce: size_utils.reduce_sum
        }),
        // TODO chunks and blocks don't have link to system...
        /*
        db.DataChunk.mapReduce({
            map: function() {
                emit('size', this.size);
            },
            reduce: size_utils.reduce_sum
        }),*/
    ]).spread(
        function(nodes, node_vendors, buckets, objects, parts) {
            nodes = _.mapValues(_.indexBy(nodes, '_id'), 'value');
            parts = _.mapValues(_.indexBy(parts, '_id'), 'value');
            // chunks = chunks && _.mapValues(_.indexBy(chunks, '_id'), 'value');
            return {
                allocated_storage: nodes.alloc || 0,
                used_storage: parts.size || 0,
                chunks_storage: 0, //chunks.size || 0,
                nodes: nodes.count || 0,
                online_nodes: nodes.online || 0,
                node_vendors: node_vendors || 0,
                buckets: buckets || 0,
                objects: objects || 0,
            };
        }
    );
}



//////////
// UTIL //
//////////


function find_system_by_id_and_permission(req, permission_check_func) {
    var system_id = req.rest_params.id;
    var perm_info = {
        system: system_id,
        account: req.account.id,
    };
    return Q.fcall(
        function() {
            return db.SystemPermission.findOne(perm_info).exec();
        }
    ).then(
        function(perm) {
            if (!perm) {
                console.error('no system permission', perm_info);
                throw new Error('no system permission');
            }
            if (permission_check_func) {
                return permission_check_func(perm);
            }
        }
    ).then(
        function() {
            return db.System.findById(system_id).exec();
        }
    ).then(
        function(system) {
            if (!system) {
                console.error('no such system', system_id);
                throw new Error('no such system');
            }
            return system;
        }
    );
}

function must_have_admin_permission(perm) {
    if (!perm.is_admin) {
        throw new Error('expected system permission of admin');
    }
}

function get_system_info(system) {
    return _.pick(system, 'id', 'name');
}
