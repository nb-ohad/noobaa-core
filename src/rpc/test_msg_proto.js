'use strict';

var _ = require('lodash');
var Q = require('q');
var util = require('util');
var dgram = require('dgram');
var EventEmitter = require('events').EventEmitter;
var MsgProto = require('./msg_proto');
var promise_utils = require('../util/promise_utils');
var dbg = require('noobaa-util/debug_module')(__filename);

util.inherits(UdpChannel, EventEmitter);

function UdpChannel(proto, remotePort, remoteAddr, localPort) {
    EventEmitter.call(this);
    this.proto = proto;
    this.socket = dgram.createSocket('udp4');
    this.remotePort = remotePort;
    this.remoteAddr = remoteAddr;
    this.localPort = localPort;
    this.mtu = 1000;
    this.rtt = 1; // TODO RTT?
    this.receiveBytes = 0;
    this.sendBytes = 0;

    this.socket.on('message', this._onSocketMessage.bind(this));
    if (localPort) {
        this.socket.bind(localPort, this._onSocketBind.bind(this));
    }
}

UdpChannel.prototype.send = function(packets) {
    var self = this;
    return promise_utils.iterate(packets, function(buffer) {
        dbg.log1('UDP send to', self.remotePort, 'buffer', buffer.length);
        return Q.ninvoke(self.socket, 'send',
            buffer, 0, buffer.length,
            self.remotePort, self.remoteAddr).then(immediateQ);
    });
};

UdpChannel.prototype.handleMessage = function(buffer) {
    this.receiveBytes += buffer.length;
    this.emit('message', buffer);
};

UdpChannel.prototype.sendMessage = function(buffer) {
    this.sendBytes += buffer.length;
    this.proto.sendMessage(this, buffer);
};

UdpChannel.prototype._onSocketBind = function() {
    dbg.log('UDP bind ready', this.localPort);
    this.emit('ready');
};

UdpChannel.prototype._onSocketMessage = function(buffer, rinfo) {
    dbg.log1('UDP message from', rinfo, 'buffer', buffer.length);
    this.proto.handlePacket(this, buffer);
};

function immediateQ() {
    var defer = Q.defer();
    setImmediate(defer.resolve);
    // setTimeout(defer.resolve, 1);
    return defer.promise;
}

// TEST ///////////////////////////////////////////////////////////////////////


var channel = new UdpChannel(
    new MsgProto(),
    process.env.UDP_REMOTE_PORT,
    process.env.UDP_REMOTE_ADDR || '127.0.0.1',
    process.env.UDP_LOCAL_PORT);

var startTime = Date.now();

function clientNext() {
    if (channel.sendBytes < 100 * 1024 * 1024) {
        var buffer = new Buffer(1024 * 1024);
        var speed = channel.sendBytes / (Date.now() - startTime) * 1000 / 1024 / 1024;
        dbg.log('CLIENT SEND', buffer.length, 'total', channel.sendBytes, speed.toFixed(1), 'MB/sec');
        channel.sendMessage(buffer);
    } else {
        dbg.log('CLIENT DONE');
        channel.socket.close();
    }

}

channel.on('ready', function() {
    if (process.env.CLIENT) {
        channel.on('message', clientNext);
        clientNext();
    } else {
        channel.on('message', function(buffer) {
            dbg.log('SERVER RECEIVED', buffer.length, 'total', channel.receiveBytes);
            channel.sendMessage(new Buffer(1));
        });
    }
});
