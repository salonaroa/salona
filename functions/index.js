const functions = require('firebase-functions');
const pug = require('pug');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const express = require('express');
const app = express();
app.set('view engine', 'pug');
const { JSDOM } = require('jsdom');
const window = new JSDOM('').window;
const createDOMPurify = require('dompurify');
const DOMPurify = createDOMPurify(window);
const showdown = require('showdown');
const crypto = require('crypto');

function safe_html(markdown) {
    return DOMPurify.sanitize(new showdown.Converter().makeHtml(markdown));
}

function getHash(input, type) {
    return crypto.createHash('sha256').update(input, type).digest('hex');
}

function notFound(res) {
    const content = '<p>そのページはありません。</p>';
    res.status(404).render('document', { title: '404', content: content });
}

function validNonce(nonce) {
    const isString = typeof nonce === 'string';
    const isHex = nonce.match(/^[a-f0-9]{64}$/) !== null;
    return !(isString && isHex);
}

app.get('/', (req, res) => { res.render('index'); });

app.get('/salona', (req, res) => { res.render('salona'); });

app.get('/create', (req, res) => { res.render('create'); });

app.get('/search', (req, res) => {
    const title = req.query.q;
    const hash = req.query.after;
    let query;
    if (hash) {
        const ref = db.collection('documents');
        query = ref.where('title', '==', title).where('hash', '>', hash);
    }
    else { query = db.collection('documents').where('title', '==', title); }
    query.orderBy('hash').limit(10).get().then(snapshot => {
        let documents = [];
        let after = null;
        snapshot.forEach(doc => {
            let power = doc.data()['power'].toString().slice(0, 6);
            let content = safe_html(doc.data()['content']);
            documents.push({ id: doc.id, power: power, content: content });
            after = doc.data()['hash'];
        });
        const locals = { title: title, documents: documents, after: after };
        res.render('search', locals);
        return;
    }).catch();
});

app.post('/upload', (req, res) => {
    const body = JSON.parse(req.body);
    const data = {}
    data.title = body['title'];
    data.content = body['content'];
    data.nonce = '0'.repeat(64);
    const id = getHash('# ' + data.title + '\n' + data.content, 'utf-8');
    data.hash = getHash(id + data.nonce, 'hex');
    data.power = 256 - Math.log2(parseInt(data.hash, 16));
    db.collection('documents').doc(id).get().then(doc => {
        if (!doc.exists) {
            return db.collection('documents').doc(id).set(data);
        }
        else { return null; }
    }).then(() => { res.send(id); return; }).catch();
});

app.get('/vote/:id', (req, res) => {
    const id = req.params['id'];
    const nonce = req.query.nonce;
    db.collection('documents').doc(id).get().then(doc => {
        if (validNonce(nonce) || !doc.exists) { notFound(res); return null; }
        const hash = getHash(doc.id + nonce, 'hex');
        const power = 256 - Math.log2(parseInt(hash, 16));
        const data = { nonce: nonce, hash: hash, power: power };
        if (hash < doc.data()['hash']) {
            const docRef = db.collection('documents').doc(id);
            return docRef.set(data, { merge: true });
        }
        else { return null; }
    }).then(() => { res.send('受け取りました。'); return; }).catch();
});

app.get('/nonce/:id', (req, res) => {
    const id = req.params['id'];
    db.collection('documents').doc(id).get().then(doc => {
        if (!doc.exists) { notFound(res); return; }
        res.send(doc.data()['nonce']);
        return;
    }).catch();
});

app.get('/sitemap' , (req, res) => {
    db.collection('documents').get().then(snapshot => {
        let documents = [];
        snapshot.forEach(doc => {
            documents.push('https://salona.org/' + doc.id);
        });
        res.send(documents.join('\n'));
        return;
    }).catch();
});

app.get('/raw/:id', (req, res) => {
    db.collection('documents').doc(req.params['id']).get().then(doc => {
        if (!doc.exists) { notFound(res); return; }
        let data = doc.data();
        let title = data['title'];
        let content = data['content'];
        res.send('# ' + title + '\n' + content);
        return;
    }).catch();
})

app.get('/:id', (req, res) => {
    db.collection('documents').doc(req.params['id']).get().then(doc => {
        if (!doc.exists) { notFound(res); return; }
        const data = {};
        data.id = doc.id;
        data.title = doc.data()['title'];
        data.content = safe_html(doc.data()['content']);
        res.render('document', data);
        return;
    }).catch();
});

app.use((req, res, next) => { notFound(res); });

exports.app = functions.https.onRequest(app);
