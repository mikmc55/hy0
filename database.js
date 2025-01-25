const mongoose = require('mongoose');
const logger = require('./logger');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/stremio-manager';

// Connection options
const options = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
};

// Create connection
let db;

async function connectDB() {
    try {
        if (!db) {
            db = await mongoose.connect(MONGODB_URI, options);
            logger.info('MongoDB connected successfully');
        }
        return db;
    } catch (error) {
        logger.error('MongoDB connection error:', error);
        throw error;
    }
}

// Initialize connection before starting server
async function initializeDB() {
    await connectDB();
}

mongoose.connection.on('error', err => {
    logger.error('MongoDB error:', err);
});

mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected. Attempting to reconnect...');
    connectDB();
});

// Define schemas
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    lastSync: Date,
    managedBy: { type: String, required: true }
});

const addonSchema = new mongoose.Schema({
    transportUrl: { type: String, required: true },
    transportName: { type: String, default: 'http' },
    manifest: {
        id: String,
        name: String,
        version: String,
        description: String,
        logo: String,
        icon: String
    },
    flags: { type: Map, of: Boolean },
    userEmail: { type: String, required: true }
});

const catalogSchema = new mongoose.Schema({
    userEmail: { type: String, required: true },
    addons: [{
        transportUrl: String,
        transportName: String,
        manifest: {
            id: String,
            name: String,
            version: String,
            description: String,
            logo: String,
            icon: String
        },
        flags: { type: Map, of: Boolean }
    }]
});

// Create models
const User = mongoose.model('User', userSchema);
const Addon = mongoose.model('Addon', addonSchema);
const Catalog = mongoose.model('Catalog', catalogSchema);

// Database helper functions
async function ensureUserDatabases(email) {
    const catalog = await Catalog.findOne({ userEmail: email });
    if (!catalog) {
        await Catalog.create({ userEmail: email, addons: [] });
    }
}

async function readDatabase(email) {
    const addons = await Addon.find({ userEmail: email });
    return addons;
}

async function writeDatabase(email, data) {
    await Addon.deleteMany({ userEmail: email });
    if (data.length > 0) {
        const addonsWithUser = data.map(addon => ({ ...addon, userEmail: email }));
        await Addon.insertMany(addonsWithUser);
    }
    logger.debug('Database updated successfully');
}

async function readUsersDatabase(email) {
    const users = await User.find({ managedBy: email });
    return users.map(user => ({
        email: user.email,
        password: user.password,
        lastSync: user.lastSync
    }));
}

async function writeUsersDatabase(email, data) {
    await User.deleteMany({ managedBy: email });
    if (data.length > 0) {
        const usersWithManager = data.map(user => ({
            ...user,
            managedBy: email
        }));
        await User.insertMany(usersWithManager);
    }
    logger.debug('Users database updated successfully');
}

async function writeCatalog(email, catalogs) {
    await Catalog.findOneAndUpdate(
        { userEmail: email },
        { addons: catalogs },
        { upsert: true }
    );
}

async function readCatalog(email) {
    const catalog = await Catalog.findOne({ userEmail: email });
    return catalog ? catalog.addons : [];
}

module.exports = {
    connectDB,
    initializeDB,
    ensureUserDatabases,
    readDatabase,
    writeDatabase,
    readUsersDatabase,
    writeUsersDatabase,
    writeCatalog,
    readCatalog,
    models: {
        User,
        Addon,
        Catalog
    }
};
