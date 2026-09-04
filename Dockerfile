# Phase 4 multi-stage sketch. Prefer host package install on Mac.
# Customize image build for your environment (deps + browsers).
FROM node:22-bookworm AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY src ./src
COPY prompts ./prompts
COPY showcase ./showcase

FROM base AS worker
ENV HEADLESS=1 WORKER_HEADLESS=1
WORKDIR /app

FROM node:22-bookworm AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY src ./src
COPY showcase ./showcase
COPY web ./web
WORKDIR /app/web
ENV AUTH_SECRET=dev-insecure-change-me AUTH_URL=http://localhost:3000
EXPOSE 3000
