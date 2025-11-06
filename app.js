// Ancient Coin Collection App
// Import Three.js dynamically if available
let THREE, GLTFLoader, OBJLoader, OrbitControls;
let threeJsAvailable = false;

// Constants
const PLACEHOLDER_IMAGE = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"%3E%3Crect fill="%23f0f0f0" width="400" height="400"/%3E%3Ctext fill="%23999" font-family="sans-serif" font-size="40" x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle"%3ENo Image%3C/text%3E%3C/svg%3E';
const VIEWER_INIT_DELAY = 100; // Delay needed for DOM element to be fully rendered

// Try to load Three.js modules
async function loadThreeJS() {
    try {
        const threeModule = await import('three');
        THREE = threeModule;
        
        const { OrbitControls: OC } = await import('three/addons/controls/OrbitControls.js');
        OrbitControls = OC;
        
        const { GLTFLoader: GL } = await import('three/addons/loaders/GLTFLoader.js');
        GLTFLoader = GL;
        
        const { OBJLoader: OL } = await import('three/addons/loaders/OBJLoader.js');
        OBJLoader = OL;
        
        threeJsAvailable = true;
    } catch (error) {
        console.warn('Three.js not available, 3D viewer will use fallback mode');
        threeJsAvailable = false;
    }
}

class CoinCollection {
    constructor() {
        this.coins = this.loadCoins();
        this.currentViewer = null;
        this.initEventListeners();
        this.renderCoins();
    }

    // Load coins from localStorage
    loadCoins() {
        const saved = localStorage.getItem('coinCollection');
        return saved ? JSON.parse(saved) : [];
    }

    // Save coins to localStorage
    saveCoins() {
        localStorage.setItem('coinCollection', JSON.stringify(this.coins));
    }

    // Initialize event listeners
    initEventListeners() {
        // Toggle form visibility
        document.getElementById('toggleFormBtn').addEventListener('click', () => {
            document.getElementById('addCoinForm').classList.toggle('hidden');
        });

        // Form submission
        document.getElementById('coinForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addCoin();
        });

        // Cancel button
        document.getElementById('cancelBtn').addEventListener('click', () => {
            document.getElementById('addCoinForm').classList.add('hidden');
            document.getElementById('coinForm').reset();
        });

        // Search functionality
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.filterCoins(e.target.value);
        });

        // Sort functionality
        document.getElementById('sortSelect').addEventListener('change', (e) => {
            this.sortCoins(e.target.value);
        });

        // Close modal
        document.querySelector('.close-modal').addEventListener('click', () => {
            this.closeModal();
        });

        // Close modal on outside click
        document.getElementById('coinModal').addEventListener('click', (e) => {
            if (e.target.id === 'coinModal') {
                this.closeModal();
            }
        });
    }

    // Add a new coin
    async addCoin() {
        const coin = {
            id: Date.now(),
            name: document.getElementById('coinName').value,
            date: document.getElementById('coinDate').value,
            origin: document.getElementById('coinOrigin').value,
            ruler: document.getElementById('coinRuler').value,
            material: document.getElementById('coinMaterial').value,
            weight: document.getElementById('coinWeight').value,
            diameter: document.getElementById('coinDiameter').value,
            description: document.getElementById('coinDescription').value,
            obverse: document.getElementById('coinObverse').value,
            reverse: document.getElementById('coinReverse').value,
            images: [],
            model3D: null,
            addedDate: new Date().toISOString()
        };

        // Process images
        const imageFiles = document.getElementById('coinImages').files;
        for (let file of imageFiles) {
            const base64 = await this.fileToBase64(file);
            coin.images.push(base64);
        }

        // Process 3D model
        const modelFile = document.getElementById('coin3DModel').files[0];
        if (modelFile) {
            const base64 = await this.fileToBase64(modelFile);
            coin.model3D = {
                data: base64,
                filename: modelFile.name,
                type: modelFile.type
            };
        }

        this.coins.push(coin);
        this.saveCoins();
        this.renderCoins();

        // Reset form
        document.getElementById('coinForm').reset();
        document.getElementById('addCoinForm').classList.add('hidden');
    }

    // Convert file to base64
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // Escape HTML to prevent XSS
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Delete a coin
    deleteCoin(id) {
        if (confirm('Are you sure you want to delete this coin from your collection?')) {
            this.coins = this.coins.filter(coin => coin.id !== id);
            this.saveCoins();
            this.renderCoins();
        }
    }

    // Render all coins
    renderCoins() {
        const grid = document.getElementById('coinsGrid');
        const emptyState = document.getElementById('emptyState');

        if (this.coins.length === 0) {
            grid.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        grid.innerHTML = this.coins.map(coin => this.createCoinCard(coin)).join('');

        // Add event listeners to cards
        this.coins.forEach(coin => {
            document.getElementById(`view-${coin.id}`).addEventListener('click', () => {
                this.viewCoin(coin.id);
            });
            document.getElementById(`delete-${coin.id}`).addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteCoin(coin.id);
            });
        });
    }

    // Create HTML for a coin card
    createCoinCard(coin) {
        const imageUrl = coin.images.length > 0 ? coin.images[0] : PLACEHOLDER_IMAGE;
        
        return `
            <div class="coin-card">
                <div class="coin-card-images">
                    <img src="${imageUrl}" alt="${coin.name}">
                    ${coin.images.length > 1 ? `<span class="image-count">📷 ${coin.images.length}</span>` : ''}
                    ${coin.model3D ? '<span class="coin-card-badge">3D</span>' : ''}
                </div>
                <div class="coin-card-content">
                    <h3>${coin.name}</h3>
                    <div class="coin-info">
                        <div class="coin-info-item">
                            <span>Date:</span>
                            <strong>${coin.date}</strong>
                        </div>
                        ${coin.origin ? `
                            <div class="coin-info-item">
                                <span>Origin:</span>
                                <strong>${coin.origin}</strong>
                            </div>
                        ` : ''}
                        ${coin.ruler ? `
                            <div class="coin-info-item">
                                <span>Ruler:</span>
                                <strong>${coin.ruler}</strong>
                            </div>
                        ` : ''}
                    </div>
                </div>
                <div class="coin-card-actions">
                    <button id="view-${coin.id}" class="btn-view">View Details</button>
                    <button id="delete-${coin.id}" class="btn-delete">Delete</button>
                </div>
            </div>
        `;
    }

    // View coin details in modal
    viewCoin(id) {
        const coin = this.coins.find(c => c.id === id);
        if (!coin) return;

        const modalBody = document.getElementById('modalBody');
        modalBody.innerHTML = `
            <div class="modal-header">
                <h2>${coin.name}</h2>
            </div>

            ${coin.images.length > 0 ? `
                <div class="modal-images">
                    ${coin.images.map(img => `<img src="${img}" alt="${coin.name}">`).join('')}
                </div>
            ` : ''}

            ${coin.model3D ? `
                <div class="modal-3d-viewer">
                    <h3>360° 3D View</h3>
                    <div id="viewer3D"></div>
                </div>
            ` : ''}

            <div class="modal-info">
                <div class="info-section">
                    <h3>Basic Information</h3>
                    <div class="info-item">
                        <strong>Date/Period:</strong>
                        <span>${coin.date}</span>
                    </div>
                    ${coin.origin ? `
                        <div class="info-item">
                            <strong>Origin/Mint:</strong>
                            <span>${coin.origin}</span>
                        </div>
                    ` : ''}
                    ${coin.ruler ? `
                        <div class="info-item">
                            <strong>Ruler/Authority:</strong>
                            <span>${coin.ruler}</span>
                        </div>
                    ` : ''}
                </div>

                <div class="info-section">
                    <h3>Physical Details</h3>
                    ${coin.material ? `
                        <div class="info-item">
                            <strong>Material:</strong>
                            <span>${coin.material}</span>
                        </div>
                    ` : ''}
                    ${coin.weight ? `
                        <div class="info-item">
                            <strong>Weight:</strong>
                            <span>${coin.weight} g</span>
                        </div>
                    ` : ''}
                    ${coin.diameter ? `
                        <div class="info-item">
                            <strong>Diameter:</strong>
                            <span>${coin.diameter} mm</span>
                        </div>
                    ` : ''}
                </div>

                <div class="info-section">
                    <h3>Coin Sides</h3>
                    ${coin.obverse ? `
                        <div class="info-item">
                            <strong>Obverse:</strong>
                            <span>${coin.obverse}</span>
                        </div>
                    ` : ''}
                    ${coin.reverse ? `
                        <div class="info-item">
                            <strong>Reverse:</strong>
                            <span>${coin.reverse}</span>
                        </div>
                    ` : ''}
                </div>
            </div>

            ${coin.description ? `
                <div class="modal-description">
                    <h3>Description & Notes</h3>
                    <p>${coin.description}</p>
                </div>
            ` : ''}
        `;

        document.getElementById('coinModal').classList.remove('hidden');

        // Initialize 3D viewer if model exists (delayed to ensure DOM is ready)
        if (coin.model3D) {
            setTimeout(() => this.init3DViewer(coin.model3D), VIEWER_INIT_DELAY);
        }
    }

    // Initialize 3D viewer with Three.js
    init3DViewer(model3D) {
        const container = document.getElementById('viewer3D');
        if (!container || this.currentViewer) return;

        // If Three.js is not available, show a fallback message
        if (!threeJsAvailable) {
            container.innerHTML = `
                <div class="viewer-fallback">
                    <p class="viewer-fallback-title">3D Model: ${this.escapeHtml(model3D.filename)}</p>
                    <p class="viewer-fallback-message">3D viewer requires online connection for Three.js library</p>
                    <button class="btn-primary viewer-fallback-btn" data-download="true">
                        Download 3D Model
                    </button>
                </div>
            `;
            
            // Add event listener for download button
            const downloadBtn = container.querySelector('[data-download="true"]');
            if (downloadBtn) {
                downloadBtn.addEventListener('click', () => {
                    const link = document.createElement('a');
                    link.href = model3D.data;
                    link.download = model3D.filename;
                    link.click();
                });
            }
            return;
        }

        const width = container.clientWidth;
        const height = container.clientHeight;

        // Create scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf5f5f5);

        // Create camera
        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        camera.position.set(0, 0, 5);

        // Create renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(renderer.domElement);

        // Add lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 5, 5);
        scene.add(directionalLight);

        const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
        directionalLight2.position.set(-5, -5, -5);
        scene.add(directionalLight2);

        // Add orbit controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 2.0;

        // Load model
        this.load3DModel(scene, model3D);

        // Animation loop
        const animate = () => {
            if (!this.currentViewer) return;
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();

        // Store viewer reference
        this.currentViewer = { renderer, scene, camera, controls };

        // Handle window resize
        const handleResize = () => {
            if (!container) return;
            const width = container.clientWidth;
            const height = container.clientHeight;
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
        };
        window.addEventListener('resize', handleResize);
    }

    // Load 3D model
    load3DModel(scene, model3D) {
        if (!threeJsAvailable) return;
        
        const extension = model3D.filename.split('.').pop().toLowerCase();
        
        // Convert base64 to blob (optimized)
        const base64Data = model3D.data.split(',')[1];
        const byteCharacters = atob(base64Data);
        const byteArray = Uint8Array.from(byteCharacters, char => char.charCodeAt(0));
        const blob = new Blob([byteArray]);
        const url = URL.createObjectURL(blob);

        if (extension === 'glb' || extension === 'gltf') {
            const loader = new GLTFLoader();
            loader.load(url, (gltf) => {
                const model = gltf.scene;
                
                // Center and scale model
                const box = new THREE.Box3().setFromObject(model);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                const scale = 2 / maxDim;
                
                model.scale.setScalar(scale);
                model.position.sub(center.multiplyScalar(scale));
                
                scene.add(model);
            }, undefined, (error) => {
                console.error('Error loading 3D model:', error);
            });
        } else if (extension === 'obj') {
            const loader = new OBJLoader();
            loader.load(url, (object) => {
                // Center and scale model
                const box = new THREE.Box3().setFromObject(object);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                const scale = 2 / maxDim;
                
                object.scale.setScalar(scale);
                object.position.sub(center.multiplyScalar(scale));
                
                // Add material if needed
                object.traverse((child) => {
                    if (child instanceof THREE.Mesh && !child.material) {
                        child.material = new THREE.MeshPhongMaterial({ color: 0xcccccc });
                    }
                });
                
                scene.add(object);
            }, undefined, (error) => {
                console.error('Error loading OBJ model:', error);
            });
        }
    }

    // Close modal
    closeModal() {
        document.getElementById('coinModal').classList.add('hidden');
        
        // Clean up 3D viewer
        if (this.currentViewer) {
            const container = document.getElementById('viewer3D');
            if (container) {
                container.innerHTML = '';
            }
            this.currentViewer = null;
        }
    }

    // Filter coins by search term
    filterCoins(searchTerm) {
        const filtered = this.coins.filter(coin => {
            const term = searchTerm.toLowerCase();
            return coin.name.toLowerCase().includes(term) ||
                   coin.date.toLowerCase().includes(term) ||
                   (coin.origin && coin.origin.toLowerCase().includes(term)) ||
                   (coin.ruler && coin.ruler.toLowerCase().includes(term)) ||
                   (coin.description && coin.description.toLowerCase().includes(term));
        });

        const grid = document.getElementById('coinsGrid');
        const emptyState = document.getElementById('emptyState');

        if (filtered.length === 0) {
            grid.innerHTML = '';
            emptyState.innerHTML = '<p>No coins found matching your search.</p>';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        grid.innerHTML = filtered.map(coin => this.createCoinCard(coin)).join('');

        // Re-add event listeners
        filtered.forEach(coin => {
            document.getElementById(`view-${coin.id}`).addEventListener('click', () => {
                this.viewCoin(coin.id);
            });
            document.getElementById(`delete-${coin.id}`).addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteCoin(coin.id);
            });
        });
    }

    // Sort coins
    sortCoins(sortBy) {
        switch (sortBy) {
            case 'newest':
                this.coins.sort((a, b) => new Date(b.addedDate) - new Date(a.addedDate));
                break;
            case 'oldest':
                this.coins.sort((a, b) => new Date(a.addedDate) - new Date(b.addedDate));
                break;
            case 'name':
                this.coins.sort((a, b) => a.name.localeCompare(b.name));
                break;
        }
        this.renderCoins();
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    await loadThreeJS();
    new CoinCollection();
});
