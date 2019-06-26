/* Copyright (C) 2016 NooBaa */

import { merge, of } from 'rxjs';
import { mergeMap, catchError } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { SIGN_IN, SIGN_IN_WITH_OAUTH } from 'action-types';
import { completeSignIn, failSignIn } from 'action-creators';

export default function(action$, { api }) {
    // handles sign in request with email and password.
    const credentialsBasedSignIn$ = action$.pipe(
        ofType(SIGN_IN),
        mergeMap(async action => {
            const { email, password, persistent } = action.payload;
            await api.create_auth_token({ email, password });
            const { systems } = await api.system.list_systems();
            const { name: system } = systems[0];
            const res  = await api.create_auth_token({ system, email, password });
            return { ...res, persistent };
        })
    );

    // handles sign in request from an oauth srouce.
    const k8sBasedSignIn$ =  action$.pipe(
        ofType(SIGN_IN_WITH_OAUTH),
        mergeMap(async action => {
            const { oauthGrantCode: grant_code } = action.payload;
            const res = await api.create_k8s_auth({ grant_code });
            return { ...res, persistent: false };
        })
    );

    return merge(
        credentialsBasedSignIn$,
        k8sBasedSignIn$,
    ).pipe(
        mergeMap(async res => {
            const { info, token, persistent } = res;
            const account = await api.account.read_account({ email: info.account.email });
            const theme = account.preferences.ui_theme.toLowerCase();
            return completeSignIn(token, info, persistent, theme);
        }),
        catchError(error => {
            if (error.rpc_code !== 'UNAUTHORIZED') throw error;
            return of(failSignIn(mapErrorObject(error)));
        })
    );
}
