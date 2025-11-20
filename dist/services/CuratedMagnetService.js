"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CuratedMagnetService = void 0;
const logger_1 = require("../utils/logger");
class CuratedMagnetService {
    constructor() {
        this.magnets = new Map();
        this.logger = new logger_1.Logger('CuratedMagnetService');
        this.initializeDefaultMagnets().catch(error => this.logger.error('Error initializing default magnets', { error: error.message }));
    }
    async initializeDefaultMagnets() {
        try {
            const fs = await Promise.resolve().then(() => __importStar(require('fs-extra')));
            const path = await Promise.resolve().then(() => __importStar(require('path')));
            const magnetsPath = path.join(process.cwd(), 'data/magnets.json');
            if (await fs.pathExists(magnetsPath)) {
                const data = await fs.readJson(magnetsPath);
                if (data.magnets && Array.isArray(data.magnets)) {
                    let loadedCount = 0;
                    data.magnets.forEach((magnet) => {
                        try {
                            this.addMagnet({
                                ...magnet,
                                addedAt: new Date(magnet.addedAt || Date.now())
                            });
                            loadedCount++;
                        }
                        catch (error) {
                            this.logger.warn('Skipping invalid magnet during initialization', {
                                title: magnet.title,
                                error: error instanceof Error ? error.message : 'Unknown error'
                            });
                        }
                    });
                    this.logger.info('Default magnets initialized', { loadedCount, totalMagnets: data.magnets.length });
                }
                else {
                    this.logger.warn('Invalid magnets.json structure - magnets array not found');
                }
            }
            else {
                this.logger.info('No magnets.json found - starting with empty catalog');
            }
        }
        catch (error) {
            this.logger.error('Failed to initialize default magnets', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    extractBaseImdbId(fullId) {
        if (!fullId || typeof fullId !== 'string') {
            return fullId;
        }
        const baseId = fullId.split(':')[0];
        if (/^tt\d+$/.test(baseId)) {
            return baseId;
        }
        return fullId;
    }
    validateMagnet(magnet) {
        const requiredFields = ['imdbId', 'title', 'magnet', 'quality', 'seeds'];
        const missingFields = requiredFields.filter(field => !magnet[field]);
        if (missingFields.length > 0) {
            throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
        }
        if (!magnet.magnet.startsWith('magnet:?')) {
            throw new Error('Invalid magnet link format');
        }
        if (!magnet.imdbId.startsWith('tt')) {
            throw new Error('Invalid IMDb ID format');
        }
        const validQualities = ['4K', '1080p', '720p', 'SD'];
        if (!validQualities.includes(magnet.quality)) {
            throw new Error(`Invalid quality: ${magnet.quality}. Must be one of: ${validQualities.join(', ')}`);
        }
        if (magnet.seeds < 0) {
            throw new Error('Seeds count cannot be negative');
        }
    }
    addMagnet(magnet) {
        try {
            this.validateMagnet(magnet);
            const baseImdbId = this.extractBaseImdbId(magnet.imdbId);
            if (!this.magnets.has(baseImdbId)) {
                this.magnets.set(baseImdbId, []);
            }
            const existingMagnets = this.magnets.get(baseImdbId);
            const existingIndex = existingMagnets.findIndex(m => m.magnet === magnet.magnet);
            if (existingIndex === -1) {
                existingMagnets.push({
                    ...magnet,
                    imdbId: baseImdbId
                });
                this.logger.info('Magnet added successfully', {
                    title: magnet.title,
                    imdbId: baseImdbId,
                    quality: magnet.quality
                });
            }
            else {
                existingMagnets[existingIndex] = {
                    ...magnet,
                    imdbId: baseImdbId
                };
                this.logger.info('Magnet updated successfully', {
                    title: magnet.title,
                    imdbId: baseImdbId
                });
            }
        }
        catch (error) {
            this.logger.error('Failed to add magnet', {
                title: magnet.title,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }
    removeMagnet(imdbId, magnetLink) {
        const baseImdbId = this.extractBaseImdbId(imdbId);
        const magnets = this.magnets.get(baseImdbId);
        if (!magnets) {
            this.logger.debug('No magnets found for IMDb ID', { imdbId: baseImdbId });
            return false;
        }
        const initialLength = magnets.length;
        const filteredMagnets = magnets.filter(m => m.magnet !== magnetLink);
        if (filteredMagnets.length === 0) {
            this.magnets.delete(baseImdbId);
        }
        else {
            this.magnets.set(baseImdbId, filteredMagnets);
        }
        const removed = initialLength !== filteredMagnets.length;
        if (removed) {
            this.logger.info('Magnet removed successfully', {
                imdbId: baseImdbId,
                magnetsRemaining: filteredMagnets.length
            });
        }
        else {
            this.logger.debug('Magnet not found for removal', { imdbId: baseImdbId });
        }
        return removed;
    }
    searchMagnets(request) {
        const { id, title, imdbId } = request;
        let results = [];
        const searchId = imdbId || id;
        if (searchId) {
            const baseImdbId = this.extractBaseImdbId(searchId);
            if (this.magnets.has(baseImdbId)) {
                results = [...this.magnets.get(baseImdbId)];
                this.logger.debug('Found magnets by IMDb ID', {
                    baseImdbId,
                    originalId: searchId,
                    count: results.length
                });
            }
        }
        if (results.length === 0 && title) {
            this.logger.debug('Falling back to title search', { title });
            for (const magnets of this.magnets.values()) {
                const matching = magnets.filter(magnet => magnet.title.toLowerCase().includes(title.toLowerCase()));
                results.push(...matching);
            }
            if (results.length > 0) {
                this.logger.debug('Found magnets by title search', {
                    title,
                    count: results.length
                });
            }
        }
        this.logger.debug('Magnet search completed', {
            requestId: id,
            searchId,
            title,
            resultsCount: results.length
        });
        return this.sortByQualityAndSeeds(results);
    }
    sortByQualityAndSeeds(magnets) {
        const qualityScore = {
            '4K': 4,
            '1080p': 3,
            '720p': 2,
            'SD': 1
        };
        return magnets.sort((a, b) => {
            const qualityA = qualityScore[a.quality] || 0;
            const qualityB = qualityScore[b.quality] || 0;
            if (qualityB !== qualityA) {
                return qualityB - qualityA;
            }
            if (b.seeds !== a.seeds) {
                return b.seeds - a.seeds;
            }
            return a.title.localeCompare(b.title);
        });
    }
    getAllMagnets() {
        const allMagnets = [];
        for (const magnets of this.magnets.values()) {
            allMagnets.push(...magnets);
        }
        return allMagnets;
    }
    getMagnetsByImdbId(imdbId) {
        const baseImdbId = this.extractBaseImdbId(imdbId);
        return this.magnets.get(baseImdbId) || [];
    }
    getStats() {
        let totalMagnets = 0;
        for (const magnets of this.magnets.values()) {
            totalMagnets += magnets.length;
        }
        return {
            totalMagnets,
            uniqueTitles: this.magnets.size,
            catalogSize: this.magnets.size
        };
    }
    clearAllMagnets() {
        const previousSize = this.magnets.size;
        this.magnets.clear();
        this.logger.info('All magnets cleared', {
            previousCatalogSize: previousSize
        });
    }
}
exports.CuratedMagnetService = CuratedMagnetService;
