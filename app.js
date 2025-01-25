require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const fetch = require('node-fetch');
const cors = require('cors');
const logger = require('./logger');
const db = require('./database');
const app = express();
const port = process.env.PORT || 3001;

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

// Helper functions
async function stremioRequest(endpoint, body) {
    try {
        logger.debug(`Making Stremio API request to ${endpoint}`);
        const response = await fetch(`${STREMIO_API.BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain;charset=UTF-8',
                'Accept': '*/*'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`Stremio API error: ${response.status}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        logger.error(`Stremio API request failed:`, error);
        throw error;
    }
}

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (req.session.isAuthenticated) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

// Basic Routes
app.get('/api/auth/status', (req, res) => {
    res.json({ 
        isAuthenticated: !!req.session.isAuthenticated,
        stremioConnected: !!req.session.stremioAuthKey,
        stremioUser: req.session.stremioUser || null
    });
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const response = await stremioRequest(STREMIO_API.LOGIN, {
            type: "Login",
            email,
            password,
            facebook: false
        });

        if (!response.result?.authKey) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const authKey = response.result.authKey;
        await db.ensureUserDatabases(email);
        
        req.session.isAuthenticated = true;
        req.session.stremioAuthKey = authKey;
        req.session.stremioUser = { email, password, authKey };

        const addonResponse = await stremioRequest(STREMIO_API.ADDON_COLLECTION_GET, {
            type: "AddonCollectionGet",
            authKey: authKey
        });

        if (addonResponse.addons) {
            await db.writeCatalog(email, addonResponse.addons);

            const nonOfficialAddons = addonResponse.addons.filter(addon => 
                !addon.flags?.official && !addon.flags?.protected
            );
            await db.writeDatabase(email, nonOfficialAddons);

            const users = await db.readUsersDatabase(email);
            if (!users.some(user => user.email === email)) {
                users.push({
                    email,
                    password,
                    lastSync: new Date().toISOString()
                });
                await db.writeUsersDatabase(email, users);
            }
        }

        res.json({ 
            success: true, 
            addons: addonResponse.addons || [],
            user: response.result.user
        });
    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/logout', (req, res) => {
    if (req.session.stremioAuthKey) {
        stremioRequest(STREMIO_API.LOGOUT, {
            type: "Logout",
            authKey: req.session.stremioAuthKey
        }).catch(error => {
            logger.error('Stremio logout error:', error);
        });
    }
    req.session.destroy();
    res.json({ success: true });
});

// Catalog Routes
app.get('/api/catalogs/main', requireAuth, async (req, res) => {
    try {
        const mainUserEmail = req.session.stremioUser.email;
        const catalogs = await db.readCatalog(mainUserEmail);
        
        res.json({
            mainUser: mainUserEmail,
            catalogs: catalogs || []
        });
    } catch (error) {
        logger.error('Error fetching main user catalogs:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/user/catalog', requireAuth, async (req, res) => {
    try {
        const authKey = req.session.stremioAuthKey;
        const response = await stremioRequest(STREMIO_API.ADDON_COLLECTION_GET, {
            type: "AddonCollectionGet",
            authKey: authKey
        });

        const addons = response.result?.addons || [];
        const userEmail = req.session.stremioUser.email;
        
        await db.writeCatalog(userEmail, addons);

        const nonOfficialAddons = addons.filter(addon => 
            !addon.flags?.official && !addon.flags?.protected
        );
        await db.writeDatabase(userEmail, nonOfficialAddons);

        res.json({
            success: true,
            catalog: addons
        });
    } catch (error) {
        logger.error('Error fetching catalog:', error);
        res.status(500).json({ error: error.message });
    }
});

// Addon Management Routes
app.get('/api/addons', requireAuth, async (req, res) => {
    try {
        const data = await db.readDatabase(req.session.stremioUser.email);
        res.json(data);
    } catch (error) {
        logger.error('Error reading addons:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/addons', requireAuth, async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'Manifest URL is required' });
        }

        const mainUserEmail = req.session.stremioUser.email;
        const stremioResponse = await stremioRequest(STREMIO_API.ADDON_COLLECTION_GET, {
            type: "AddonCollectionGet",
            authKey: req.session.stremioAuthKey,
        });

        const currentAddons = stremioResponse.result?.addons || [];
        const manifestResponse = await fetch(url);
        
        if (!manifestResponse.ok) {
            throw new Error(`Failed to fetch manifest: ${manifestResponse.status}`);
        }

        const manifest = await manifestResponse.json();
        const isDuplicate = currentAddons.some(addon => 
            addon.manifest.id === manifest.id || 
            addon.transportUrl === url
        );
        
        if (isDuplicate) {
            return res.status(400).json({ error: 'Addon already exists' });
        }

        const newAddon = {
            transportUrl: url,
            transportName: "http",
            manifest: manifest,
            flags: {}
        };

        const updatedAddons = [...currentAddons, newAddon];

        await stremioRequest(STREMIO_API.ADDON_COLLECTION_SET, {
            type: "AddonCollectionSet",
            authKey: req.session.stremioAuthKey,
            addons: updatedAddons
        });

        await db.writeCatalog(mainUserEmail, updatedAddons);
        const nonOfficialAddons = updatedAddons.filter(addon => 
            !addon.flags?.official && !addon.flags?.protected
        );
        await db.writeDatabase(mainUserEmail, nonOfficialAddons);

        res.json({ 
            success: true, 
            addons: updatedAddons 
        });

    } catch (error) {
        logger.error('Error adding addon:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/addons/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const mainUserEmail = req.session.stremioUser.email;

        const stremioResponse = await stremioRequest(STREMIO_API.ADDON_COLLECTION_GET, {
            type: "AddonCollectionGet",
            authKey: req.session.stremioAuthKey,
        });

        const currentAddons = stremioResponse.result?.addons || [];
        const updatedAddons = currentAddons.filter(addon => addon.manifest.id !== id);

        if (updatedAddons.length === currentAddons.length) {
            return res.status(404).json({ error: 'Addon not found' });
        }

        await stremioRequest(STREMIO_API.ADDON_COLLECTION_SET, {
            type: "AddonCollectionSet",
            authKey: req.session.stremioAuthKey,
            addons: updatedAddons
        });

        await db.writeCatalog(mainUserEmail, updatedAddons);
        const nonOfficialAddons = updatedAddons.filter(addon => 
            !addon.flags?.official && !addon.flags?.protected
        );
        await db.writeDatabase(mainUserEmail, nonOfficialAddons);

        res.json({ success: true });
    } catch (error) {
        logger.error('Error deleting addon:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// User Management Routes
app.get('/api/users', requireAuth, async (req, res) => {
    try {
        const mainUserEmail = req.session.stremioUser.email;
        const users = await db.readUsersDatabase(mainUserEmail);
        res.json(users);
    } catch (error) {
        logger.error('Error fetching users:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/users', requireAuth, async (req, res) => {
    try {
        const { email, password } = req.body;
        const mainUserEmail = req.session.stremioUser.email;

        const response = await stremioRequest(STREMIO_API.LOGIN, {
            type: "Login",
            email,
            password,
            facebook: false
        });

        if (!response.result?.authKey) {
            return res.status(401).json({ error: 'Invalid Stremio credentials' });
        }

        const users = await db.readUsersDatabase(mainUserEmail);
        
        if (users.some(user => user.email === email)) {
            return res.status(400).json({ error: 'User already exists' });
        }

        users.push({
            email,
            password,
            lastSync: null
        });

        await db.writeUsersDatabase(mainUserEmail, users);
        res.json({ success: true });
    } catch (error) {
        logger.error('Error adding user:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/users/:email/sync', requireAuth, async (req, res) => {
    try {
        const { email } = req.params;
        const mainUserEmail = req.session.stremioUser.email;
        logger.debug('Starting user sync', { email });

        const users = await db.readUsersDatabase(mainUserEmail);
        const user = users.find(u => u.email === email);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const loginResponse = await stremioRequest(STREMIO_API.LOGIN, {
            type: "Login",
            email: user.email,
            password: user.password,
            facebook: false
        });

        if (!loginResponse.result?.authKey) {
            return res.status(401).json({ error: 'Failed to authenticate with Stremio' });
        }

        const mainUserCatalogs = await db.readCatalog(mainUserEmail);

        await stremioRequest(STREMIO_API.ADDON_COLLECTION_SET, {
            type: "AddonCollectionSet",
            authKey: loginResponse.result.authKey,
            addons: mainUserCatalogs
        });

        user.lastSync = new Date().toISOString();
        await db.writeUsersDatabase(mainUserEmail, users);

        await stremioRequest(STREMIO_API.LOGOUT, {
            type: "Logout",
            authKey: loginResponse.result.authKey
        });

        res.json({ success: true });
    } catch (error) {
        logger.error('Error during user sync:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/users/:email', requireAuth, async (req, res) => {
    try {
        const { email } = req.params;
        const mainUserEmail = req.session.stremioUser.email;
        const users = await db.readUsersDatabase(mainUserEmail);
        const filteredUsers = users.filter(user => user.email !== email);
        
        if (filteredUsers.length === users.length) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        await db.writeUsersDatabase(mainUserEmail, filteredUsers);
        res.json({ success: true });
    } catch (error) {
        logger.error('Error deleting user:', error);
        res.status(500).json({ error: error.message });
    }
});

// Server initialization
async function startServer() {
    try {
        await db.initializeDB();
        app.listen(port, () => {
            logger.info(`Server started on port ${port}`);
        });
    } catch (error) {
        logger.error('Failed to initialize:', error);
        process.exit(1);
    }
}
app.post('/api/import', requireAuth, async (req, res) => {
    try {
        const mainUserEmail = req.session.stremioUser.email;
        const importData = req.body;
        
        let addonsToImport = [];
        if (importData.addons) {
            addonsToImport = importData.addons;
        } else if (Array.isArray(importData)) {
            addonsToImport = importData;
        } else {
            throw new Error('Invalid import format');
        }

        const stremioResponse = await stremioRequest(STREMIO_API.ADDON_COLLECTION_GET, {
            type: "AddonCollectionGet",
            authKey: req.session.stremioAuthKey,
        });

        const currentAddons = stremioResponse.result?.addons || [];

        let results = {
            success: 0,
            failed: 0,
            duplicates: 0
        };

        for (const addon of addonsToImport) {
            if (!addon.manifest || !addon.transportUrl) {
                results.failed++;
                continue;
            }

            const isDuplicate = currentAddons.some(existing => 
                existing.manifest.id === addon.manifest.id || 
                existing.transportUrl === addon.transportUrl
            );

            if (isDuplicate) {
                results.duplicates++;
                continue;
            }

            currentAddons.push(addon);
            results.success++;
        }

        await stremioRequest(STREMIO_API.ADDON_COLLECTION_SET, {
            type: "AddonCollectionSet",
            authKey: req.session.stremioAuthKey,
            addons: currentAddons
        });

        await db.writeCatalog(mainUserEmail, currentAddons);
        const nonOfficialAddons = currentAddons.filter(addon => 
            !addon.flags?.official && !addon.flags?.protected
        );
        await db.writeDatabase(mainUserEmail, nonOfficialAddons);

        res.json({ 
            success: true,
            results: results
        });
    } catch (error) {
        logger.error('Error importing addons:', error);
        res.status(400).json({ error: error.message });
    }
});
app.get('/api/export', requireAuth, async (req, res) => {
    try {
        const mainUserEmail = req.session.stremioUser.email;
        const catalogs = await db.readCatalog(mainUserEmail);
        
        const exportData = {
            version: "1.0.0",
            exportDate: new Date().toISOString(),
            addons: catalogs.filter(addon => !addon.flags?.official && !addon.flags?.protected)
        };
        
        res.json(exportData);
    } catch (error) {
        logger.error('Error exporting addons:', error);
        res.status(500).json({ error: 'Failed to export addons' });
    }
});
app.post('/api/stremio/register', async (req, res) => {
    try {
        const { email, password } = req.body;

        const response = await stremioRequest(STREMIO_API.REGISTER, {
            type: "Register",
            email,
            password,
            gdpr: true,
            facebook: false
        });

        if (response.error) {
            return res.status(400).json({ error: response.error });
        }

        res.json({ success: true });
    } catch (error) {
        logger.error('Stremio registration error:', error);
        res.status(500).json({ error: error.message });
    }
});
startServer();

module.exports = app;

