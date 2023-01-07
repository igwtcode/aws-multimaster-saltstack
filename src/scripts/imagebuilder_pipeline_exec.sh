#!/bin/bash

# ec2 imagebuilder pipeline arn
IMAGEBUILDER_SALT_MASTER_ARN=""
IMAGEBUILDER_SALT_MINION_ARN=""

echo "START..."

echo "execute [${IMAGEBUILDER_SALT_MASTER_ARN}] image builder pipeline..."
aws imagebuilder start-image-pipeline-execution --image-pipeline-arn ${IMAGEBUILDER_SALT_MASTER_ARN}

echo "execute [${IMAGEBUILDER_SALT_MINION_ARN}] image builder pipeline..."
aws imagebuilder start-image-pipeline-execution --image-pipeline-arn ${IMAGEBUILDER_SALT_MINION_ARN}

echo "DONE."