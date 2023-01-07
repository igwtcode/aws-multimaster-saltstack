#!/bin/bash

sudo systemctl is-active --quiet salt-minion || sudo systemctl restart salt-minion
sudo systemctl is-active --quiet salt-master || sudo systemctl restart salt-master
sudo systemctl is-active --quiet salt-api || sudo systemctl restart salt-api
