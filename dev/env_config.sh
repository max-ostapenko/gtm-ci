#!/bin/bash

# install dependencies
if [[ $(node -v | grep -c v14) < 1 ]]; then
    curl -sL https://deb.nodesource.com/setup_14.x | sudo -E bash -
    sudo apt install -y nodejs
fi

npm install
