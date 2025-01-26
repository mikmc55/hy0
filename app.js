require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const path = require('path');
const fetch = require('node-fetch');
const cors = require('cors');
const logger = require('./logger');

const app = express();
const port = process.env.PORT || 3001;

// MongoDB connection setup
const mongoUri = "mongodb+srv://mikmc55:vD6kL6jADy4Mxl5B@hy0.av11l.mongodb.net/?retryWrites=true&w=majority&appName=hy0";
mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => logger.info('Connected to MongoDB successfully'))
.catch(err => logger.error('Failed to connect to MongoDB:', err));

// Configuration and constants setup
const config = {
    SESSION_SECRET: process.env.SESSION_SECRET || "bhdsaububsb387444nxkj"
};

const STREMIO_API = {
    BASE_URL: "https://api.strem.io/api",
    LOGIN: "/login",
    REGISTER: "/register",
    ADDON_COLLECTION_GET: "/addonCollectionGet",
    ADDON_COLLECTION_SET: "/addonCollectionSet",
    LOGOUT: "/logout"
};

const corsOptions = {
    origin: "*",
    methods: ["GET", "POST", "DELETE", "PUT", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    maxAge: 86400
};

// Process error handlers
process.on("uncaughtException", (error) => {
    logger.error("Uncaught Exception:", error);
    process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Middleware setup
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.static("public"));
app.use(session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: false,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Routes and logic remain unchanged
// Insert your existing routes and middleware here

// Server initialization
async function startServer() {
    try {
        app.listen(port, () => {
            logger.info(`Server started on port ${port}`);
        });
    } catch (error) {
        logger.error('Failed to initialize:', error);
        process.exit(1);
    }
}

startServer();

module.exports = app;
