/* Copyright (C) 2016 NooBaa */

import NotificationApiImpl from './notifications';
import { new_rpc_default_only } from 'nb-api';
import { action$ } from 'state';
import { expireSession } from 'action-creators';

const rpc_proto = global.WebSocket ?
    (location.protocol === 'https:' ? 'wss:' : 'ws:') :
    location.protocol;

const base_address = `${rpc_proto}//${global.location.host}`;

const rpc = new_rpc_default_only(base_address);

rpc.register_service(
    rpc.schema.frontend_notifications_api,
    new NotificationApiImpl(action$),
    {}
);

// using rpc hook to handle UNAUTHORIZED errors in any flow and go to login
rpc.should_emit_request_errors = true;
rpc.on('request_error', err => {
    if (err.rpc_code === 'UNAUTHORIZED') {
        action$.next(expireSession());
    }
});

const api = rpc.new_client();
rpc.on('reconnect', () => api.redirector.register_for_alerts());

export default api;

