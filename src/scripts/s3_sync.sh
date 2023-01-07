#!/bin/bash

# bucket names
SALT_MASTER_BUCKET_NAME=""
IMAGEBUILDER_SALT_MASTER_BUCKET_NAME=""
IMAGEBUILDER_SALT_MINION_BUCKET_NAME=""

echo "START..."

cd $PWD/src/data

aws s3 sync salt-master/. s3://${SALT_MASTER_BUCKET_NAME}

aws s3 sync image-builder/salt-master/. s3://${IMAGEBUILDER_SALT_MASTER_BUCKET_NAME}

aws s3 sync image-builder/salt-minion/. s3://${IMAGEBUILDER_SALT_MINION_BUCKET_NAME}

echo "DONE."