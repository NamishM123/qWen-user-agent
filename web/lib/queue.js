import { loadRootEnv } from './load-env.js';
import {
  openQueue,
  enqueue,
  enqueueAsync,
  getTask,
  getTaskAsync,
  listTasks,
  listTasksAsync,
  listEvents,
  listEventsAsync,
  appendEvent,
  appendEventAsync,
  countRecentTasks,
  countRecentTasksAsync,
  isPostgres,
  queueImpl,
  closeQueue,
} from '../../src/queue.js';

loadRootEnv();

let opened = null;

export async function ensureQueue() {
  if (!opened) {
    opened = openQueue();
    await opened;
  }
  return {
    openQueue,
    enqueue,
    enqueueAsync,
    getTask,
    getTaskAsync,
    listTasks,
    listTasksAsync,
    listEvents,
    listEventsAsync,
    appendEvent,
    appendEventAsync,
    countRecentTasks,
    countRecentTasksAsync,
    isPostgres,
    queueImpl,
    closeQueue,
  };
}
