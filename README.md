# 🪙 Ancient Coin Collection

A modern, responsive web application for managing and displaying your personal collection of ancient coins. Built with vanilla HTML, CSS, and JavaScript for a fast, lightweight experience.

## Features

- **📷 Image Upload**: Upload multiple images for each coin (front, back, details)
- **External Image URLs**: Reference optimized images hosted on a CDN or the local `/coin-images` folder instead of storing large blobs in LocalStorage
- **3D Model Viewer**: Upload and view 3D models (.glb, .gltf, .obj) with 360° rotation
- **Detailed Information**: Track comprehensive coin details including:
  - Name, date/period, origin/mint
  - Ruler/authority, material, weight, diameter
  - Obverse and reverse descriptions
  - Custom notes and descriptions
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile devices
- **Search & Filter**: Quickly find coins in your collection
- **Sort Options**: Sort by newest, oldest, or alphabetically by name
- **Local Storage**: All data persists in your browser (no server required)
- **Modern UI**: Clean, professional interface with smooth animations

## Getting Started

### Installation

No installation required! Simply open `index.html` in a modern web browser.

```bash
# Clone the repository
git clone https://github.com/famake/coinflip.git
cd coinflip

# Open in browser
open index.html  # macOS
start index.html # Windows
xdg-open index.html # Linux
```

Or use a local development server:

```bash
# Using Python 3
python -m http.server 8000

# Using Node.js (with http-server)
npx http-server

# Then open http://localhost:8000 in your browser
```

## Usage

### Adding a Coin

1. Click the **"+ Add New Coin"** button
2. Fill in the coin details (Name and Date are required)
3. Upload images of your coin
4. (Optional) Provide external obverse/reverse image URLs. Relative paths such as `/coin-images/athens-obv.jpg` serve files from this repo's `coin-images` folder so you don't need a CDN.
5. Optionally upload a 3D model file
6. Click **"Save Coin"** to add it to your collection

### Viewing Coin Details

- Click on any coin card to view full details
- Use the 3D viewer to rotate and examine 3D models (if uploaded)
- View all uploaded images in high quality

### Managing Your Collection

- **Search**: Use the search bar to find coins by name, date, origin, ruler, or description
- **Sort**: Choose how to order your collection (newest first, oldest first, or by name)
- **Delete**: Remove coins from your collection using the delete button

### 3D Model Support

The application supports the following 3D model formats:
- `.glb` - Binary glTF
- `.gltf` - glTF JSON
- `.obj` - Wavefront OBJ

The 3D viewer features:
- Auto-rotation for 360° viewing
- Manual orbit controls (click and drag)
- Zoom in/out (scroll wheel)
- Proper lighting and shadows

### External Image URLs & `/coin-images`

- Drop optimized `.jpg` or `.png` files into the `coin-images/` folder in this repository. Any static dev server (Python, `http-server`, VS Code Live Server, etc.) will expose them at `http://localhost:PORT/coin-images/...`.
- In the form, paste either a full `https://` URL or a relative path such as `/coin-images/denarius-obv.jpg`. Those URLs take priority over uploaded files, so you can keep LocalStorage lean.
- External images remain referenced in exports/imports, so you can host them on a CDN or keep them in the repo for offline use. Just ensure the paths stay reachable wherever you open the app.

## Technology Stack

- **HTML5** - Semantic markup
- **CSS3** - Modern styling with flexbox and grid
- **JavaScript (ES6+)** - Vanilla JavaScript for functionality
- **Three.js** - 3D model rendering and viewer
- **LocalStorage API** - Client-side data persistence

## Browser Support

Works on all modern browsers:
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Data Storage

All coin data is stored locally in your browser using LocalStorage:
- Images are stored as base64-encoded strings
- 3D models are stored as base64-encoded files
- No server or database required
- Data persists between sessions
- Export/backup functionality can be added if needed

## Privacy & Security

- All data stays on your device
- No external servers or APIs (except CDN for Three.js library)
- No tracking or analytics
- Perfect for private collections

## Future Enhancements

Potential features to add:
- Export/import collection data
- Print-friendly views
- Advanced filtering (by material, ruler, date range)
- Collection statistics and insights
- Multiple collection support
- Share individual coins via URL

## Contributing

This is a personal project, but suggestions and improvements are welcome!

## License

MIT License - Feel free to use this for your own coin collection!

## Acknowledgments

- Three.js for 3D rendering capabilities
- Modern web standards that make this possible without frameworks