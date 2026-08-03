// queues/bullBoardSetup.js
// Sets up Bull Board — a real-time dashboard UI for monitoring the AI queue.
// Mounts at /admin/queues (restricted to admin users in server.js).

const { createBullBoard } = require('@bull-board/api');
const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');
const { ExpressAdapter } = require('@bull-board/express');
const { aiQueue } = require('./aiQueue');

let boardRouter = null;

/**
 * Initialise Bull Board and return the Express router.
 * Call once, after aiQueue is created.
 *
 * @returns {import('express').Router}
 */
function getBullBoardRouter() {
    if (boardRouter) return boardRouter;

    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/admin/queues');

    createBullBoard({
        queues: [new BullMQAdapter(aiQueue)],
        serverAdapter,
    });

    boardRouter = serverAdapter.getRouter();
    console.log('[Bull Board] ✅ Dashboard available at /admin/queues');
    return boardRouter;
}

module.exports = { getBullBoardRouter };
