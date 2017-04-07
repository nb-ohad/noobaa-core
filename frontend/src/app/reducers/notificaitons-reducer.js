import { createReducer } from 'utils/reducer-utils';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {
    nextId: 0,
    list: []
};

// ------------------------------
// Action Handlers
// ------------------------------
function onInitApplication() {
    return initialState;
}

// --------------------------------------------------------------------
// REFACTOR: this is used for backword compatability where
// that sender is an old architecture action
// --------------------------------------------------------------------
function onShowNotification(notifications, { severity, message }) {
    return _queueNotification(notifications, severity, message);
}

function onHideNotification(notifications, { id }) {
    const newlist = notifications.list
        .filter(notification => notification.id != id);

    return { ...notifications, list: newlist };
}

function onAccountCreationFailed(notifications, { email }) {
    _queueNotification(
        notifications,
        `Creating account ${email} failed`,
        'error'
    );
}

function onAccountS3Updated(notifications, { email }) {
    _queueNotification(
        notifications,
        `${email} S3 access updated successfully`,
        'success'
    );
}

function onAccountS3UpdateFailed(notifications, { email }) {
    _queueNotification(
        notifications,
        `Updating ${email} S3 access failed`,
        'error'
    );
}

// ------------------------------
// Local util functions
// ------------------------------
function _queueNotification(notifications, severity, message) {
    const { list, nextId } = notifications;
    return {
        list: [ ...list, { id: nextId, severity, message } ],
        nextId: nextId + 1
    };
}


// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer({
    INIT_APPLICATION: onInitApplication,
    HIDE_NOTIFICATION: onHideNotification,
    SHOW_NOTIFICATION: onShowNotification,
    ACCOUNT_CREATION_FAILED: onAccountCreationFailed,
    ACCOUNT_S3_ACCESS_UPDATED: onAccountS3Updated,
    ACCOUNT_S3_ACCESS_UPDATE_FAILED: onAccountS3UpdateFailed,

});