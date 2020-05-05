/* Copyright (C) 2016 NooBaa */
'use strict';

const { make_array } = require('./js_utils');

const alloc_empty_obj = () => ({});
const noop = () => { /* noop */ };

class ObjectPool {
    constructor(capacity, allocator, initializer, empty_value = null) {
        if (!capacity) {
            console.warn('ObjectPool - Invalid operation, cannot create a pool without capacity');
        }

        this._capacity = capacity;
        this._initalize = initializer || noop;
        this._empty_value = empty_value;
        this._next = 0;

        const allocate = allocator || alloc_empty_obj;
        this._items = make_array(capacity, allocate);
    }

    alloc() {
        if (this._next === this._capacity) {
            console.warn('ObjectPool - Could not allocate, pool is empty');
            return this._empty_value;
        }

        const item = this._items[this._next];
        this._items[this._next] = this._empty_value;
        this._next += 1;

        return item;
    }

    release(item) {
        if (this._next === 0) {
            console.warn('ObjectPool - Could not release, pool is at full capacity');
            return;
        }

        this._initalize(item);
        this._next -= 1;
        this._items[this._next] = item;
    }
}

exports.ObjectPool = ObjectPool;
