Place coin image files in this folder.
Recommended filenames: <coinId>-obv.jpg and <coinId>-rev.jpg or <slug>.jpg
Accepted formats by default: .jpg .jpeg .png .webp
After adding images, run: docker compose up --build
They will be served under /coin-images/ in the container (e.g. http://localhost:8080/coin-images/123-obv.jpg)
