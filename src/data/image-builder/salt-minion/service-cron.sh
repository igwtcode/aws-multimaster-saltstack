#!/bin/bash

sudo systemctl is-active --quiet salt-minion || sudo systemctl restart salt-minion
