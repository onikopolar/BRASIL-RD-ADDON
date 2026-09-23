"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamStatusException = void 0;
class StreamStatusException extends Error {
    constructor(staticResponse, serviceStatus, progress, message) {
        super(message || `Stream status: ${staticResponse}`);
        this.name = 'StreamStatusException';
        this.staticResponse = staticResponse;
        this.serviceStatus = serviceStatus;
        this.progress = progress;
    }
}
exports.StreamStatusException = StreamStatusException;
exports.default = StreamStatusException;
