const SidebarLayout = () => {
    const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
    const [activeSection, setActiveSection] = React.useState('dashboard');

    // Menu items configuration
    const menuItems = [
        { id: 'dashboard', label: 'Dashboard', iconName: 'layout-dashboard' },
        { id: 'register', label: 'Register Stremio', iconName: 'user-plus' },
        { id: 'addons', label: 'Add New Addon', iconName: 'package' },
        { id: 'users', label: 'Manage Users', iconName: 'users' },
        { id: 'settings', label: 'Settings', iconName: 'settings' }
    ];

    // Effect to move mainContent on first render
    React.useEffect(() => {
        const mainContent = document.getElementById('mainContent');
        const sidebarMainContent = document.querySelector('#root .content-area');
        
        if (mainContent && sidebarMainContent) {
            // Move the content
            mainContent.classList.remove('hidden');
            sidebarMainContent.appendChild(mainContent);
            
            // Show initial section
            showSection('dashboard');
        }
    }, []);

    // Function to handle section switching
    const showSection = (sectionId) => {
        setActiveSection(sectionId);

        // Hide all sections
        document.querySelectorAll('.section-content').forEach(section => {
            section.classList.add('hidden');
        });

        // Show selected section
        const selectedSection = document.getElementById(`${sectionId}Section`);
        if (selectedSection) {
            selectedSection.classList.remove('hidden');
            
            // Update content based on section
            switch (sectionId) {
                case 'dashboard':
                    if (window.updateDashboardStats) {
                        window.updateDashboardStats();
                    }
                    break;
                case 'users':
                    if (window.updateUsersList) {
                        window.updateUsersList();
                    }
                    break;
                case 'addons':
                    if (window.updateAddonList) {
                        window.updateAddonList();
                    }
                    break;
            }
        }
    };

    return React.createElement('div', { 
        className: 'min-h-screen bg-gray-900'
    }, [
        // Top Bar
        React.createElement('div', { 
            className: 'bg-gray-800 border-b border-gray-700 shadow-xl fixed top-0 left-0 right-0 h-16 z-30 flex items-center px-4' 
        }, [
            React.createElement('button', {
                key: 'toggle-button',
                onClick: () => setIsSidebarOpen(!isSidebarOpen),
                className: 'p-2 hover:bg-gray-700 rounded-lg text-gray-300'
            }, [
                React.createElement('i', {
                    key: 'toggle-icon',
                    'data-lucide': isSidebarOpen ? 'panel-left-close' : 'panel-left-open',
                    className: 'w-6 h-6'
                })
            ]),
            React.createElement('h1', { 
                key: 'title',
                className: 'text-xl font-semibold ml-4 text-gray-100' 
            }, 'Stremio Addon Manager')
        ]),

        // Sidebar
        React.createElement('div', {
            className: `fixed left-0 top-16 h-[calc(100vh-4rem)] bg-gray-800 border-r border-gray-700 shadow-xl 
                       transition-all duration-300 z-20 ${isSidebarOpen ? 'w-64' : 'w-20'}`
        }, [
            React.createElement('nav', { 
                key: 'nav',
                className: 'p-4' 
            }, 
                menuItems.map(item => 
                    React.createElement('button', {
                        key: item.id,
                        onClick: () => showSection(item.id),
                        className: `w-full flex items-center px-4 py-3 mb-2 rounded-lg transition-colors
                            ${activeSection === item.id 
                                ? 'bg-blue-600/20 text-blue-400' 
                                : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'}
                            ${!isSidebarOpen ? 'justify-center' : ''}`
                    }, [
                        React.createElement('i', {
                            key: 'icon',
                            'data-lucide': item.iconName,
                            className: 'w-5 h-5'
                        }),
                        isSidebarOpen && React.createElement('span', {
                            key: 'label',
                            className: 'ml-3'
                        }, item.label)
                    ])
                )
            )
        ]),

        // Main Content Area
        React.createElement('div', {
            className: `pt-16 transition-all duration-300 ${isSidebarOpen ? 'ml-64' : 'ml-20'}`
        }, [
            React.createElement('div', { 
                key: 'content-wrapper',
                className: 'p-6' 
            }, [
                React.createElement('div', { 
                    key: 'content-area',
                    className: 'max-w-6xl mx-auto content-area'
                })
            ])
        ])
    ]);
};

// Initialize icons after component renders
const initIcons = () => {
    lucide.createIcons();
};

// Make the component and initialization function available globally
window.SidebarLayout = SidebarLayout;
window.initIcons = initIcons;
