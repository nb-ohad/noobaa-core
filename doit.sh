
ROOT="new_reports";
FOLDER=$ROOT/$1
PERF_FILE=$FOLDER/perf.log
REPORT_FILE=$FOLDER/report.log
SAMPLES_FILE=$FOLDER/sample.log
SUMMARY_FILE=$FOLDER/summary.log

ENDPOINT_POD=$(oc get pod -o name -l noobaa-s3 | cut -c5-)
NB_ENDPOINT=https://192.168.64.50:31720
ACCESS_KEY=fUQCM8EZviNZpEo6U1kp
SECRET_KEY=NKODCTxFuBMQ8vJLG3yjwkszrK7u0bkv/zfFUvrw

function ensure_root() {
    if [ ! -d "$ROOT" ]
    then
        mkdir $ROOT
    fi
}

function create_folder() {
     if [ -z "$FOLDER" ]
    then
        echo "Folder name not provided"
        exit 1
    fi

    if [ -d "$FOLDER" ]
    then
        echo "$ROOT/$FOLDER already exists, please delete the folder then re-run"
        exit 1
    fi

    mkdir $FOLDER
}

function restart_endpoint() {
    echo "Restarting endpoint"
    LINE=($(oc exec $ENDPOINT_POD -it ps -- -ef | grep s3r))
    oc exec $ENDPOINT_POD -it kill -- ${LINE[1]}
    sleep 15
}

function preform_test() {
    echo "Preforming test (60sec)"
    node ./src/tools/s3perf.js \
        --endpoint=$NB_ENDPOINT \
        --size_units=KB \
        --access_key=$ACCESS_KEY \
        --secret_key=$SECRET_KEY \
        --put obj \
        --selfsigned  \
        --time=180  \
        --size=1 \
        | tee $PERF_FILE
}

function copy_results() {
    echo "Copying results from pod"
    oc exec $ENDPOINT_POD -it cat /root/node_modules/noobaa-core/m_report.log > $REPORT_FILE
    oc exec $ENDPOINT_POD -it cat /root/node_modules/noobaa-core/m_samples.log > $SAMPLES_FILE
}

function wait_for_results() {
    echo "Waiting 1 minute to generate reports"
    sleep 60
}

function generate_summary() {
    echo "Generating summary"
    node ./digest_samples.js $SAMPLES_FILE | tee $SUMMARY_FILE
}

function main() {
    ensure_root
    create_folder
    restart_endpoint
    preform_test
    wait_for_results
    copy_results
    generate_summary
}

main;
