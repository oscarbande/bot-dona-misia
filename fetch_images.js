const https = require('https');
const fs = require('fs');
const path = require('path');

const plants = [
    { title: 'Herbal_medicine', filename: 'hero.jpg' },
    { title: 'Aloe_vera', filename: 'sabila.jpg' },
    { title: 'Malva_sylvestris', filename: 'marba.jpg' },
    { title: 'Dianthus', filename: 'clavellina.jpg' },
    { title: 'Oregano', filename: 'oregano.jpg' },
    { title: 'Lemon', filename: 'limon.jpg' },
    { title: 'Chamomile', filename: 'manzanilla.jpg' },
    { title: 'Green_tea', filename: 'teverde.jpg' },
    { title: 'Spearmint', filename: 'hierbabuena.jpg' },
    { title: 'Eucalyptus_globulus', filename: 'eucalipto.jpg' },
    { title: 'Ginger', filename: 'jengibre.jpg' }
];

const imgDir = path.join(__dirname, 'img');
if (!fs.existsSync(imgDir)) {
    fs.mkdirSync(imgDir);
}

const fetchImage = (title, filename) => {
    return new Promise((resolve, reject) => {
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${title}`;
        https.get(url, { headers: { 'User-Agent': 'PlantCatalogBot/1.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.originalimage && json.originalimage.source) {
                        const imgUrl = json.originalimage.source;
                        
                        const file = fs.createWriteStream(path.join(imgDir, filename));
                        https.get(imgUrl, (imgRes) => {
                            imgRes.pipe(file);
                            file.on('finish', () => {
                                file.close();
                                console.log(`Downloaded ${filename} successfully`);
                                resolve();
                            });
                        }).on('error', (e) => reject(e));
                    } else if (json.thumbnail && json.thumbnail.source) {
                        const imgUrl = json.thumbnail.source;
                        const file = fs.createWriteStream(path.join(imgDir, filename));
                        https.get(imgUrl, (imgRes) => {
                            imgRes.pipe(file);
                            file.on('finish', () => {
                                file.close();
                                console.log(`Downloaded thumbnail for ${filename} successfully`);
                                resolve();
                            });
                        }).on('error', (e) => reject(e));
                    } else {
                        console.log(`No image found for ${title}`);
                        resolve();
                    }
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', (e) => reject(e));
    });
};

async function downloadAll() {
    for (const plant of plants) {
        try {
            await fetchImage(plant.title, plant.filename);
        } catch (e) {
            console.error(`Failed to fetch ${plant.title}: ${e.message}`);
        }
    }
    console.log('All downloads completed.');
}

downloadAll();
