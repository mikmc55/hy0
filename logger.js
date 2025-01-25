const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Define log format
const logFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// Create logs directory if it doesn't exist
const logDir = 'logs';

// Configure daily rotate file transport
const fileRotateTransport = new DailyRotateFile({
    filename: path.join(logDir, 'stremio-addon-manager-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    createSymlink: true,
    symlinkName: 'current.log'
});

// Create logger instance
const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: logFormat,
    transports: [
        // Write all logs with level 'error' and below to error.log
        new winston.transports.File({ 
            filename: path.join(logDir, 'error.log'), 
            level: 'error',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            )
        }),
        // Write all logs with level 'info' and below to combined.log
        fileRotateTransport
    ]
});

// If we're not in production, also log to the console with colorized output
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
            winston.format.printf(({ level, message, timestamp, stack }) => {
                if (stack) {
                    return `${timestamp} ${level}: ${message}\n${stack}`;
                }
                return `${timestamp} ${level}: ${message}`;
            })
        )
    }));
}

// Create a stream object with a write function for Morgan
logger.stream = {
    write: function(message) {
        logger.info(message.trim());
    }
};

module.exports = logger;