"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEVICE_STRATEGIES = void 0;
exports.getStreamStrategyForDevice = getStreamStrategyForDevice;
exports.filterQualitiesForDevice = filterQualitiesForDevice;
exports.DEVICE_STRATEGIES = {
    mobile: {
        preferredQualities: ['720p', '480p', '360p'],
        preferredCodecs: ['h264', 'h265'],
        maxResolution: '1080p',
        optimizations: {
            mobileDataSaving: true,
            lowPowerMode: true,
            bandwidthAware: true
        }
    },
    tablet: {
        preferredQualities: ['1080p', '720p', '480p'],
        preferredCodecs: ['h264', 'h265', 'vp9'],
        maxResolution: '1440p',
        optimizations: {
            mobileDataSaving: false,
            lowPowerMode: false,
            bandwidthAware: true
        }
    },
    desktop: {
        preferredQualities: ['4K', '1080p', '720p'],
        preferredCodecs: ['h265', 'vp9', 'av1', 'h264'],
        maxResolution: '4K',
        optimizations: {
            mobileDataSaving: false,
            lowPowerMode: false,
            bandwidthAware: false
        }
    },
    smarttv: {
        preferredQualities: ['4K', '1080p'],
        preferredCodecs: ['h265', 'h264'],
        maxResolution: '4K',
        optimizations: {
            mobileDataSaving: false,
            lowPowerMode: false,
            bandwidthAware: false
        }
    },
    default: {
        preferredQualities: ['1080p', '720p'],
        preferredCodecs: ['h264'],
        maxResolution: '1080p',
        optimizations: {
            mobileDataSaving: false,
            lowPowerMode: false,
            bandwidthAware: false
        }
    }
};
function getStreamStrategyForDevice(deviceInfo) {
    const deviceType = deviceInfo.deviceType.toLowerCase();
    return exports.DEVICE_STRATEGIES[deviceType] || exports.DEVICE_STRATEGIES.default;
}
function filterQualitiesForDevice(availableQualities, deviceInfo) {
    const strategy = getStreamStrategyForDevice(deviceInfo);
    return availableQualities
        .filter(quality => {
        const qualityRank = getQualityRank(quality);
        const maxRank = getQualityRank(strategy.maxResolution);
        return qualityRank <= maxRank;
    })
        .sort((a, b) => {
        const aIndex = strategy.preferredQualities.indexOf(a);
        const bIndex = strategy.preferredQualities.indexOf(b);
        if (aIndex !== -1 && bIndex !== -1)
            return aIndex - bIndex;
        if (aIndex !== -1)
            return -1;
        if (bIndex !== -1)
            return 1;
        return getQualityRank(b) - getQualityRank(a);
    });
}
function getQualityRank(quality) {
    const ranks = {
        '8K': 10,
        '4K': 9,
        '2160p': 9,
        '1440p': 8,
        '1080p': 7,
        '720p': 6,
        '480p': 5,
        '360p': 4,
        '240p': 3,
        'HD': 6,
        'SD': 4,
        'unknown': 0
    };
    return ranks[quality] || 5;
}
