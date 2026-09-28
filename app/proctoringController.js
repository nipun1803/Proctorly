import fs from 'fs';
import path from 'path';
import electron from 'electron';
const { desktopCapturer, screen } = electron;
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
        this.captureIntervalMs = 10000;
        this.captureTimer = null;
    }

    setWindow(win) {
        this.window = win;
    }

    getState() {
        return this.state;
    }

    getSessionDir() {
        if (!this.session || !this.session.sessionId) return null;
        return path.join(import.meta.dirname, '../backend/data/sessions', this.session.sessionId);
    }

    async startSession({ sessionId, studentId, studentName, mode = 'PROCTORED', durationSec = 1800 }) {
        this.session = {
            sessionId,
            studentId,
            studentName,
            mode,
            durationSec,
            files: [],
            screenshots: [],
            cameraShots: []
        };
        this.state = EXAM_STATES.ACTIVE;
        this.startSurveillance();
        return this.session;
    }

    startSurveillance() {
        if (this.captureTimer) clearInterval(this.captureTimer);
        this.captureTimer = setInterval(() => {
            if (this.state === EXAM_STATES.ACTIVE) {
                this.captureDesktopSurveillance();
                if (this.window) {
                    this.window.webContents.send('request-face-snapshot', {
                        timestamp: new Date().toISOString(),
                        questionId: this.currentQuestionId
                    });
                }
            }
        }, this.captureIntervalMs);
    }

    async captureDesktopSurveillance() {
        try {
            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: { width: 1280, height: 720 }
            });
            if (sources.length > 0) {
                const img = sources[0].thumbnail.toJPEG(65);
                const sessionDir = this.getSessionDir();
                if (sessionDir) {
                    const filename = `${Date.now()}.jpg`;
                    const outPath = path.join(sessionDir, 'screenshots', filename);
                    fs.mkdirSync(path.dirname(outPath), { recursive: true });
                    fs.writeFileSync(outPath, img);
                }
            }
        } catch (err) {
            console.error('Surveillance capture error:', err.message);
        }
    }

    async stopSession(endState = EXAM_STATES.SUBMITTED, reason = 'Normal completion') {
        if (this.captureTimer) clearInterval(this.captureTimer);
        this.state = endState;
        return this.session;
    }
}
