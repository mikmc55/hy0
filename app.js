const express = require('express');
const session = require('express-session');
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const cors = require('cors');
const logger = require('./logger');
const app = express();
const port = 3001;

// Configuration
const config = {
    DB_BASE_PATH: path.join(__dirname, "databases"),
    SESSION_SECRET: "bhdsaububsb387444nxkj"
};

// Stremio API endpoints
const STREMIO_API = {
    BASE_URL: "https://api.strem.io/api",
    LOGIN: "/login",
    REGISTER: "/register",
    ADDON_COLLECTION_GET: "/addonCollectionGet",
    ADDON_COLLECTION_SET: "/addonCollectionSet",
    LOGOUT: "/logout"
};

// CORS Configuration
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

// Database Helper Functions
async function ensureUserDatabases(email) {
    const userDir = path.join(config.DB_BASE_PATH, email.replace('@', '_at_'));
    await fs.mkdir(userDir, { recursive: true });

    const dbPaths = {
        addons: path.join(userDir, "addons.json"),
        users: path.join(userDir, "users.json"),
        catalogs: path.join(userDir, "catalogs.json")
    };

    for (const [key, path] of Object.entries(dbPaths)) {
        try {
            await fs.access(path);
        } catch {
            await fs.writeFile(path, JSON.stringify(key === 'catalogs' ? {} : []));
        }
    }

    return dbPaths;
}

async function getUserDatabases(email) {
    const userDir = path.join(config.DB_BASE_PATH, email.replace('@', '_at_'));
    return {
        addons: path.join(userDir, "addons.json"),
        users: path.join(userDir, "users.json"),
        catalogs: path.join(userDir, "catalogs.json")
    };
}

async function readDatabase(email) {
    const paths = await getUserDatabases(email);
    const data = await fs.readFile(paths.addons, 'utf8');
    return JSON.parse(data);
}

async function writeDatabase(email, data) {
    const paths = await getUserDatabases(email);
    await fs.writeFile(paths.addons, JSON.stringify(data, null, 2));
    logger.debug('Database updated successfully');
}

async function readUsersDatabase(email) {
    const paths = await getUserDatabases(email);
    const data = await fs.readFile(paths.users, 'utf8');
    return JSON.parse(data);
}

async function writeUsersDatabase(email, data) {
    const paths = await getUserDatabases(email);
    await fs.writeFile(paths.users, JSON.stringify(data, null, 2));
    logger.debug('Users database updated successfully');
}
// Stremio API helper function
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

// Basic routes
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

        // Initial login
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
        const dbPaths = await ensureUserDatabases(email);
        
        // Store session
        req.session.isAuthenticated = true;
        req.session.stremioAuthKey = authKey;
        req.session.stremioUser = { email, password, authKey };

        // Fetch latest addons from Stremio
        const addonResponse = await stremioRequest(STREMIO_API.ADDON_COLLECTION_GET, {
            type: "AddonCollectionGet",
            authKey: authKey
        });

        if (addonResponse.addons) {
            // Update catalogs with fresh data
            const catalogs = {};
            catalogs[email] = addonResponse.addons;
            await fs.writeFile(dbPaths.catalogs, JSON.stringify(catalogs, null, 2));

            // Update non-official addons
            const nonOfficialAddons = addonResponse.addons.filter(addon => 
                !addon.flags?.official && !addon.flags?.protected
            );
            await writeDatabase(email, nonOfficialAddons);

            // Update managed users (add self if needed)
            const users = await readUsersDatabase(email);
            if (!users.some(user => user.email === email)) {
                users.push({
                    email,
                    password,
                    lastSync: new Date().toISOString()
                });
                await writeUsersDatabase(email, users);
            }

            logger.debug(`Updated with ${addonResponse.addons.length} total addons`);
            logger.debug(`Stored ${nonOfficialAddons.length} non-official addons`);
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

app.get('/api/catalogs/main', requireAuth, async (req, res) => {
    try {
        const mainUserEmail = req.session.stremioUser.email;
        const paths = await getUserDatabases(mainUserEmail);
        const catalogs = JSON.parse(await fs.readFile(paths.catalogs, 'utf8'));
        
        res.json({
            mainUser: mainUserEmail,
            catalogs: catalogs[mainUserEmail] || []
        });
    } catch (error) {
        logger.error('Error fetching main user catalogs:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/user/catalog', requireAuth, async (req, res) => {
    try {
        // Get fresh catalog from Stremio
        const authKey = req.session.stremioAuthKey;
        const addonResponse = await fetch('https://api.strem.io/api/addonCollectionGet', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain;charset=UTF-8',
                'Accept': '*/*'
            },
            body: JSON.stringify({
                type: "AddonCollectionGet",
                authKey: authKey
            })
        });

        if (!addonResponse.ok) {
            throw new Error('Failed to fetch Stremio addons');
        }

        const stremioData = await addonResponse.json();
        const addons = stremioData.result?.addons || [];

        // Update local storage
        const userEmail = req.session.stremioUser.email;
        const paths = await getUserDatabases(userEmail);
        
        // Store full catalog
        const catalogs = JSON.parse(await fs.readFile(paths.catalogs, 'utf8'));
        catalogs[userEmail] = addons;
        await fs.writeFile(paths.catalogs, JSON.stringify(catalogs, null, 2));

        // Store non-official addons
        const nonOfficialAddons = addons.filter(addon => 
            !addon.flags?.official && !addon.flags?.protected
        );
        await writeDatabase(userEmail, nonOfficialAddons);

        logger.debug(`Retrieved ${addons.length} total addons from Stremio`);
        logger.debug(`Stored ${nonOfficialAddons.length} non-official addons`);

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
        const data = await readDatabase(req.session.stremioUser.email);
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

        // 1. Fetch current Stremio addons
        const stremioResponse = await stremioRequest(STREMIO_API.ADDON_COLLECTION_GET, {
            type: "AddonCollectionGet",
            authKey: req.session.stremioAuthKey,
        });

        const currentAddons = stremioResponse.result?.addons || [];

        // 2. Fetch new addon manifest
        const manifestResponse = await fetch(url);
        if (!manifestResponse.ok) {
            throw new Error(`Failed to fetch manifest: ${manifestResponse.status}`);
        }

        const manifest = await manifestResponse.json();
        
        // 3. Check for duplicates in currentAddons
        const isDuplicate = currentAddons.some(addon => 
            addon.manifest.id === manifest.id || 
            addon.transportUrl === url
        );
        
        if (isDuplicate) {
            return res.status(400).json({ error: 'Addon already exists' });
        }

        // 4. Create new addon object
        const newAddon = {
            transportUrl: url,
            transportName: "http",
            manifest: manifest,
            flags: {}
        };

        // 5. Add to Stremio
        const updatedAddons = [...currentAddons, newAddon];

        await stremioRequest(STREMIO_API.ADDON_COLLECTION_SET, {
            type: "AddonCollectionSet",
            authKey: req.session.stremioAuthKey,
            addons: updatedAddons
        });

        // 6. Update local storage
        const paths = await getUserDatabases(mainUserEmail);

        // Update catalogs
        const catalogs = JSON.parse(await fs.readFile(paths.catalogs, 'utf8'));
        catalogs[mainUserEmail] = updatedAddons;
        await fs.writeFile(paths.catalogs, JSON.stringify(catalogs, null, 2));

        // Store non-official addons
        const nonOfficialAddons = updatedAddons.filter(addon => 
            !addon.flags?.official && !addon.flags?.protected
        );
        await writeDatabase(mainUserEmail, nonOfficialAddons);

        logger.debug(`Added new addon: ${manifest.id}`);
        
        res.json({ 
            success: true, 
            addons: updatedAddons 
        });

    } catch (error) {
        logger.error('Error adding addon:', error);
        res.status(500).json({ error: error.message });
    }
});
// User Management Routes
app.get('/api/users', requireAuth, async (req, res) => {
    try {
        const mainUserEmail = req.session.stremioUser.email;
        const users = await readUsersDatabase(mainUserEmail);
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

        // Verify credentials with Stremio
        const response = await stremioRequest(STREMIO_API.LOGIN, {
            type: "Login",
            email,
            password,
            facebook: false
        });

        if (!response.result?.authKey) {
            return res.status(401).json({ error: 'Invalid Stremio credentials' });
        }

        const users = await readUsersDatabase(mainUserEmail);
        
        if (users.some(user => user.email === email)) {
            return res.status(400).json({ error: 'User already exists' });
        }

        users.push({
            email,
            password,
            lastSync: null
        });

        await writeUsersDatabase(mainUserEmail, users);
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

        const users = await readUsersDatabase(mainUserEmail);
        const user = users.find(u => u.email === email);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Login to Stremio as the target user
        const loginResponse = await stremioRequest(STREMIO_API.LOGIN, {
            type: "Login",
            email: user.email,
            password: user.password,
            facebook: false
        });

        if (!loginResponse.result?.authKey) {
            return res.status(401).json({ error: 'Failed to authenticate with Stremio' });
        }

        // Get main user's catalogs
        const paths = await getUserDatabases(mainUserEmail);
        const catalogs = JSON.parse(await fs.readFile(paths.catalogs, 'utf8'));
        const mainUserCatalogs = catalogs[mainUserEmail] || [];

        // Sync catalogs to user's account
        await stremioRequest(STREMIO_API.ADDON_COLLECTION_SET, {
            type: "AddonCollectionSet",
            authKey: loginResponse.result.authKey,
            addons: mainUserCatalogs
        });

        // Update last sync time
        user.lastSync = new Date().toISOString();
        await writeUsersDatabase(mainUserEmail, users);

        // Logout the target user
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
        const users = await readUsersDatabase(mainUserEmail);
        const filteredUsers = users.filter(user => user.email !== email);
        
        if (filteredUsers.length === users.length) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        await writeUsersDatabase(mainUserEmail, filteredUsers);
        res.json({ success: true });
    } catch (error) {
        logger.error('Error deleting user:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/stremio/register', async (req, res) => {
    try {
        const { email, password } = req.body;

        const response = await fetch('https://api.strem.io/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain;charset=UTF-8',
                'Accept': '*/*'
            },
            body: JSON.stringify({
                type: "Register",
                email,
                password,
                gdpr: true,
                facebook: false
            })
        });

        const data = await response.json();
        if (data.error) {
            return res.status(400).json({ error: data.error });
        }

        res.json({ success: true });
    } catch (error) {
        logger.error('Stremio registration error:', error);
        res.status(500).json({ error: error.message });
    }
});
app.get('/api/export', requireAuth, async (req, res) => {
    try {
        const mainUserEmail = req.session.stremioUser.email;
        const paths = await getUserDatabases(mainUserEmail);
        
        // Get catalogs for the main user
        const catalogs = JSON.parse(await fs.readFile(paths.catalogs, 'utf8'));
        const userCatalogs = catalogs[mainUserEmail] || [];
        
        // Format the export data
        const exportData = {
            version: "1.0.0",
            exportDate: new Date().toISOString(),
            addons: userCatalogs.filter(addon => !addon.flags?.official && !addon.flags?.protected)
        };
        
        res.json(exportData);
    } catch (error) {
        logger.error('Error exporting addons:', error);
        res.status(500).json({ error: 'Failed to export addons' });
    }
});
app.delete('/api/addons/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const mainUserEmail = req.session.stremioUser.email;

        // Get current Stremio addons
        const stremioResponse = await stremioRequest(STREMIO_API.ADDON_COLLECTION_GET, {
            type: "AddonCollectionGet",
            authKey: req.session.stremioAuthKey,
        });

        const currentAddons = stremioResponse.result?.addons || [];
        const updatedAddons = currentAddons.filter(addon => addon.manifest.id !== id);

        if (updatedAddons.length === currentAddons.length) {
            return res.status(404).json({ error: 'Addon not found' });
        }

        // Update Stremio
        await stremioRequest(STREMIO_API.ADDON_COLLECTION_SET, {
            type: "AddonCollectionSet",
            authKey: req.session.stremioAuthKey,
            addons: updatedAddons
        });

        // Update local storage
        const paths = await getUserDatabases(mainUserEmail);
        
        // Update catalogs
        const catalogs = JSON.parse(await fs.readFile(paths.catalogs, 'utf8'));
        catalogs[mainUserEmail] = updatedAddons;
        await fs.writeFile(paths.catalogs, JSON.stringify(catalogs, null, 2));

        // Update non-official addons
        const nonOfficialAddons = updatedAddons.filter(addon => 
            !addon.flags?.official && !addon.flags?.protected
        );
        await writeDatabase(mainUserEmail, nonOfficialAddons);

        res.json({ success: true });
    } catch (error) {
        logger.error('Error deleting addon:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.post('/api/import', requireAuth, async (req, res) => {
    try {
        const mainUserEmail = req.session.stremioUser.email;
        const importData = req.body;
        
        let addonsToImport = [];
        if (importData.addons) {
            // Handle format from export endpoint
            addonsToImport = importData.addons;
        } else if (Array.isArray(importData)) {
            // Handle array format
            addonsToImport = importData;
        } else {
            throw new Error('Invalid import format');
        }

        // Get current Stremio addons
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

        // Filter out duplicates and add new addons
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

        // Update Stremio
        await stremioRequest(STREMIO_API.ADDON_COLLECTION_SET, {
            type: "AddonCollectionSet",
            authKey: req.session.stremioAuthKey,
            addons: currentAddons
        });

        // Update local storage
        const paths = await getUserDatabases(mainUserEmail);
        const catalogs = JSON.parse(await fs.readFile(paths.catalogs, 'utf8'));
        catalogs[mainUserEmail] = currentAddons;
        await fs.writeFile(paths.catalogs, JSON.stringify(catalogs, null, 2));

        // Update non-official addons
        const nonOfficialAddons = currentAddons.filter(addon => 
            !addon.flags?.official && !addon.flags?.protected
        );
        await writeDatabase(mainUserEmail, nonOfficialAddons);

        res.json({ 
            success: true,
            results: results
        });
    } catch (error) {
        logger.error('Error importing addons:', error);
        res.status(400).json({ error: error.message });
    }
});
// Server initialization
Promise.all([
    fs.mkdir(config.DB_BASE_PATH, { recursive: true })
])
.then(() => {
    app.listen(port, () => {
        logger.info(`Server started on port ${port}`);
    });
})
.catch(error => {
    logger.error('Failed to initialize:', error);
    process.exit(1);
});

module.exports = app;
