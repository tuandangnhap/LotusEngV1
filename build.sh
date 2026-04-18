#!/usr/bin/env bash

echo "Installing ffmpeg..."
apt-get update
apt-get install -y ffmpeg

echo "Build Node..."
npm install