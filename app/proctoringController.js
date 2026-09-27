import fs from 'fs';
import path from 'path';
import electron from 'electron';
const { screen } = electron;
import { exec } from 'child_process';

export const EXAM_STATES = {
    PRE_EXAM: 'PRE_EXAM',
    READY: 'READY',
    STARTING: 'STARTING',
    ACTIVE: 'ACTIVE',
    SUBMITTING: 'SUBMITTING',
    SUBMITTED: 'SUBMITTED',
    EXPIRED: 'EXPIRED',
    ABORTED: 'ABORTED'
};

export const BLOCKED_APPS = [
    'zoom', 'teamviewer', 'discord', 'slack', 'skype', 'telegram',
    'anydesk', 'chrome remote desktop', 'vnc', 'screenshare',
    'obs', 'obs studio', 'streamlabs', 'bandicam', 'camtasia',
    'whatsapp', 'messenger', 'signal', 'line'
];

export class ProctoringController {
    constructor() {
        this.state = EXAM_STATES.PRE_EXAM;
        this.window = null;
        this.session = null;
        this.currentQuestionId = 1;
    }

    setWindow(win) {
        this.window = win;
    }

    getState() {
        return this.state;
    }

    async getBackgroundApps() {
        return new Promise((resolve) => {
            const isWin = process.platform === 'win32';
            const cmd = isWin ? 'tasklist /FO CSV /NH' : 'ps -eo comm=';

            exec(cmd, { timeout: 3000 }, (err, stdout) => {
                if (err || !stdout) return resolve([]);
                const lines = stdout.toLowerCase().split('\n');
                const detected = new Set();

                for (const target of BLOCKED_APPS) {
                    for (const line of lines) {
                        if (line.includes(target)) {
                            detected.add(target);
                            break;
                        }
                    }
                }
                resolve(Array.from(detected));
            });
        });
    }

    checkDisplays() {
        const displays = screen.getAllDisplays();
        return {
            count: displays.length,
            valid: displays.length === 1
        };
    }

    async startSession({ sessionId, studentId, studentName, mode = 'PROCTORED', durationSec = 1800 }) {
        this.session = { sessionId, studentId, studentName, mode, durationSec, startedAt: new Date().toISOString() };
        this.state = EXAM_STATES.ACTIVE;
        return this.session;
    }

    async stopSession(endState = EXAM_STATES.SUBMITTED, reason = 'Normal completion') {
        if (this.session) {
            this.session.status = endState;
            this.session.submittedAt = new Date().toISOString();
        }
        this.state = endState;
        return this.session;
    }
}
