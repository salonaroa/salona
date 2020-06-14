const functions = require('firebase-functions'); const pug = require('pug');
const admin = require('firebase-admin'); admin.initializeApp(); const db = admin.firestore();
const express = require('express'); const app = express(); app.set('view engine', 'pug');
const { JSDOM } = require('jsdom'); const window = new JSDOM('').window;
const createDOMPurify = require('dompurify'); const DOMPurify = createDOMPurify(window);
const showdown = require('showdown');
const crypto = require('crypto');

function safe_html(markdown) { return DOMPurify.sanitize(new showdown.Converter().makeHtml(markdown)); }
function hash_str(str) { return crypto.createHash('sha256').update(str, 'utf8').digest('hex'); }
function hash_hex(hex) { return crypto.createHash('sha256').update(hex, 'hex').digest('hex'); }
function shutdownSalona() { app.get('*', (req, res) => { res.status(404).send('404'); }); }

app.get('/', (req, res) => { res.render('index'); });

app.get('/salona', (req, res) => { res.render('salona'); });

app.get('/create', (req, res) => { res.render('create'); });

app.get('/search', (req, res) => {
    const q = req.query.q; const hash = req.query.after; let query;
    if (hash) { query = db.collection('documents').where('title', '==', q).where('hash', '>', hash); }
    else { query = db.collection('documents').where('title', '==', q); }
    query.orderBy('hash').limit(10).get().then(snapshot => {
        let documents = [];
        let after = null;
        snapshot.forEach(doc => {
            documents.push({ id: doc.id, power: doc.data()['power'].toString().slice(0, 6), content: safe_html(doc.data()['content']) });
            after = doc.data()['hash'];
        });
        res.render('search', { query: q, documents: documents, after: after });
        return;
    }).catch();
        
});

app.post('/upload', (req, res) => {
    const body = JSON.parse(req.body);
    const title = body['title'];
    const content = body['content'];
    const id = hash_str('# '+title+'\n'+content);
    const nonce = '0'.repeat(64);
    const hash = hash_hex(id+nonce);
    const power = 256 - Math.log2(parseInt(hash, 16));
    const data = { title: title, content: content, nonce: nonce, hash: hash, power: power }
    db.collection('documents').doc(id).get().then(doc => {
        if (!doc.exists) {
            return db.collection('documents').doc(id).set(data);
        }
        else {
            return null;
        }
    }).then(() => { res.send(id); return; }).catch();
});

app.get('/vote/:id', (req, res) => {
    const id = req.params['id']; const nonce = req.query.nonce;
    if (!(typeof nonce === 'string' && nonce.match(/^[a-f0-9]{64}$/) !== null)) { res.send('無効です。'); return; }
    db.collection('documents').doc(id).get().then(doc => {
        if (doc.exists) {
            const hash = hash_hex(doc.id + nonce); const data = { nonce: nonce, hash: hash, power: 256 - Math.log2(parseInt(hash, 16)) }
            if (hash < doc.data()['hash']) { return db.collection('documents').doc(id).set(data, { merge: true }); } else { return null; }
        } else { return null; }
    }).then(() => { res.send('受け取りました。'); return; }).catch();
});

app.get('/delete/:id', (req, res) => {
    const id = req.params['id']; const nonce = req.query.nonce;
    if (!(typeof nonce === 'string' && nonce.match(/^[a-f0-9]{64}$/) !== null)) { res.send('無効です。'); return; }
    db.collection('documents').doc(id).get().then(doc => {
        if (doc.exists) {
            const hash = hash_hex(doc.id + nonce);
            if (hash < doc.data()['hash']) { return db.collection('documents').doc(id).delete(); } else { return null; }
        } else { return null; }
    }).then(() => { res.send('受け取りました。'); return; }).catch();
});

app.get('/nonce/:id', (req, res) => {
    const id = req.params['id'];
    db.collection('documents').doc(id).get().then(doc => {
        if (doc.exists) { res.send(doc.data()['nonce']); return;
        } else { res.send(''); return; }
    }).catch();
});

app.get('/sitemap' , (req, res) => {
    db.collection('documents').get().then(snapshot => {
        let documents = []; snapshot.forEach(doc => { documents.push('https://salona.org/' + doc.id); }); res.send(documents.join('\n')); return;
    }).catch();
});

app.get('/:id', (req, res) => {
    db.collection('documents').doc(req.params['id']).get().then(doc => {
        if (doc.exists) {
            let data = doc.data(); let title = data['title']; let content = safe_html(data['content']);
            res.render('document', { title: title, content: content });
        } else { res.status(404).render('document', { title: '404', content: '<p>そのページはありません。</p>' }); } return;
    }).catch();
});

app.use((req, res, next) => { res.status(404).render('document', { title: '404', content: '<p>そのページはありません。</p>' }); });

exports.app = functions.https.onRequest(app);
