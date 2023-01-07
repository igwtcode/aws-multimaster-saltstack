#!/bin/bash

XAPIKEY=""
API_DOMAIN_NAME=""

echo 
INSTANCES_URL=https://${API_DOMAIN_NAME}/instances
echo $INSTANCES_URL
echo

curl -X GET \
  ${INSTANCES_URL} \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${XAPIKEY}" \
  -H "cache-control: no-cache" \

###

echo 
echo 
SALT_URL=https://${API_DOMAIN_NAME}/salt
echo $SALT_URL
echo

curl -X GET \
  ${SALT_URL} \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${XAPIKEY}" \
  -H "cache-control: no-cache" \

echo
echo