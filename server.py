#!/usr/bin/env python3
"""乖宝生理期 - Backend Server with Auth, Roles, Binding, and Data Sync"""
import os, sys, sqlite3, hashlib, json, uuid, datetime
from functools import wraps
from flask import Flask, request, jsonify, g, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
CORS(app)
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app.db')
SECRET_KEY = 'guai-bao-secret-key-change-in-production'

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
    return g.db

@app.teardown_appcontext
def close_db(e):
    db = g.pop('db', None)
    if db: db.close()

def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('girl','boy')),
        bind_code TEXT UNIQUE,
        bound_to_id INTEGER,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (bound_to_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT,
        notes TEXT DEFAULT '',
        ongoing_dates TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS symptoms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        pain_level INTEGER DEFAULT 0,
        flow_level INTEGER DEFAULT 0,
        mood TEXT DEFAULT '',
        tags TEXT DEFAULT '[]',
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS partner_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS meals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT DEFAULT '',
        date TEXT NOT NULL,
        content TEXT DEFAULT '',
        note TEXT DEFAULT '',
        tags TEXT DEFAULT '[]',
        photo TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    """)
    db.commit()
    db.close()

def make_token(user_id):
    payload = {
        'user_id': user_id,
        'exp': (datetime.datetime.utcnow() + datetime.timedelta(days=30)).timestamp()
    }
    import jwt
    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')

def verify_token(token):
    import jwt
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
        return payload['user_id']
    except:
        return None

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        user_id = verify_token(token)
        if not user_id:
            return jsonify({'error': '未登录或登录已过期'}), 401
        g.current_user_id = user_id
        return f(*args, **kwargs)
    return decorated

# ====== Auth ======

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    phone = data.get('phone', '').strip()
    password = data.get('password', '').strip()
    role = data.get('role', '')
    if not phone or not password or role not in ('girl', 'boy'):
        return jsonify({'error': '请填写完整信息（手机号、密码、角色）'}), 400
    db = get_db()
    if db.execute("SELECT id FROM users WHERE phone=?", (phone,)).fetchone():
        return jsonify({'error': '该手机号已注册'}), 400
    pw_hash = hashlib.sha256(password.encode()).hexdigest()
    bind_code = str(uuid.uuid4())[:8].upper() if role == 'girl' else None
    cur = db.execute("INSERT INTO users (phone,password,role,bind_code) VALUES (?,?,?,?)",
                     (phone, pw_hash, role, bind_code))
    db.commit()
    user_id = cur.lastrowid
    token = make_token(user_id)
    return jsonify({'token': token, 'user': {'id': user_id, 'phone': phone, 'role': role, 'bind_code': bind_code}})

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    phone = data.get('phone', '').strip()
    password = data.get('password', '').strip()
    if not phone or not password:
        return jsonify({'error': '请填写手机号和密码'}), 400
    db = get_db()
    pw_hash = hashlib.sha256(password.encode()).hexdigest()
    user = db.execute("SELECT * FROM users WHERE phone=? AND password=?", (phone, pw_hash)).fetchone()
    if not user:
        return jsonify({'error': '手机号或密码错误'}), 401
    token = make_token(user['id'])
    return jsonify({'token': token, 'user': dict(user)})

@app.route('/api/user', methods=['GET'])
@require_auth
def get_user():
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id=?", (g.current_user_id,)).fetchone()
    if not user:
        return jsonify({'error': '用户不存在'}), 404
    bound_user = None
    if user['bound_to_id']:
        bu = db.execute("SELECT id,phone,role FROM users WHERE id=?", (user['bound_to_id'],)).fetchone()
        if bu:
            bound_user = dict(bu)
    return jsonify({'user': dict(user), 'bound_user': bound_user})

@app.route('/api/bind', methods=['POST'])
@require_auth
def bind_user():
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id=?", (g.current_user_id,)).fetchone()
    if not user:
        return jsonify({'error': '用户不存在'}), 404
    data = request.get_json()
    bind_code = data.get('bind_code', '').strip().upper()
    if not bind_code:
        return jsonify({'error': '请输入绑定码'}), 400
    target = db.execute("SELECT * FROM users WHERE bind_code=? AND role='girl'", (bind_code,)).fetchone()
    if not target:
        return jsonify({'error': '绑定码无效'}), 404
    if target['id'] == user['id']:
        return jsonify({'error': '不能绑定自己'}), 400
    if target['bound_to_id']:
        return jsonify({'error': '对方已绑定其他用户'}), 400
    # Boy binds to girl
    if user['role'] != 'boy':
        return jsonify({'error': '只有男友端可以发起绑定'}), 400
    db.execute("UPDATE users SET bound_to_id=? WHERE id=?", (target['id'], g.current_user_id))
    db.execute("UPDATE users SET bound_to_id=? WHERE id=?", (g.current_user_id, target['id']))
    db.commit()
    return jsonify({'ok': True, 'partner_phone': target['phone']})

@app.route('/api/unbind', methods=['POST'])
@require_auth
def unbind():
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id=?", (g.current_user_id,)).fetchone()
    if not user or not user['bound_to_id']:
        return jsonify({'error': '未绑定'}), 400
    partner_id = user['bound_to_id']
    db.execute("UPDATE users SET bound_to_id=NULL WHERE id=? OR id=?", (g.current_user_id, partner_id))
    db.commit()
    return jsonify({'ok': True})

# ====== Records ======

@app.route('/api/records', methods=['GET'])
@require_auth
def get_records():
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id=?", (g.current_user_id,)).fetchone()
    # Boyfriend sees girlfriend's records
    viewing_id = g.current_user_id if user['role'] == 'girl' else user['bound_to_id']
    if not viewing_id:
        return jsonify({'records': []})
    rows = db.execute("SELECT * FROM records WHERE user_id=? ORDER BY start_date DESC", (viewing_id,)).fetchall()
    return jsonify({'records': [dict(r) for r in rows]})

@app.route('/api/records', methods=['POST'])
@require_auth
def save_records():
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id=?", (g.current_user_id,)).fetchone()
    if user['role'] != 'girl':
        return jsonify({'error': '仅女生端可记录'}), 403
    data = request.get_json()
    records = data.get('records', [])
    # Replace all records for this user
    db.execute("DELETE FROM records WHERE user_id=?", (g.current_user_id,))
    for r in records:
        db.execute("INSERT INTO records (user_id,start_date,end_date,notes,ongoing_dates) VALUES (?,?,?,?,?)",
                   (g.current_user_id, r['startDate'], r.get('endDate'), r.get('notes', ''),
                    json.dumps(r.get('ongoingDates', []), ensure_ascii=False)))
    db.commit()
    return jsonify({'ok': True})

@app.route('/api/symptoms', methods=['GET'])
@require_auth
def get_symptoms():
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id=?", (g.current_user_id,)).fetchone()
    viewing_id = g.current_user_id if user['role'] == 'girl' else user['bound_to_id']
    if not viewing_id:
        return jsonify({'symptoms': []})
    rows = db.execute("SELECT * FROM symptoms WHERE user_id=? ORDER BY date DESC", (viewing_id,)).fetchall()
    return jsonify({'symptoms': [dict(r) for r in rows]})

@app.route('/api/symptoms', methods=['POST'])
@require_auth
def save_symptoms():
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id=?", (g.current_user_id,)).fetchone()
    if user['role'] != 'girl':
        return jsonify({'error': '仅女生端可记录'}), 403
    data = request.get_json()
    symptoms = data.get('symptoms', [])
    db.execute("DELETE FROM symptoms WHERE user_id=?", (g.current_user_id,))
    for s in symptoms:
        db.execute("INSERT INTO symptoms (user_id,date,pain_level,flow_level,mood,tags,notes) VALUES (?,?,?,?,?,?,?)",
                   (g.current_user_id, s['date'], s.get('painLevel', 0), s.get('flowLevel', 0),
                    s.get('mood', ''), json.dumps(s.get('tags', []), ensure_ascii=False),
                    s.get('notes', '')))
    db.commit()
    return jsonify({'ok': True})

# ====== Partner Messages ======

@app.route('/api/partner-messages', methods=['GET'])
@require_auth
def get_partner_messages():
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id=?", (g.current_user_id,)).fetchone()
    # Girl sees her own messages; Boy sees messages from his bound girl
    viewing_id = g.current_user_id if user['role'] == 'girl' else user['bound_to_id']
    if not viewing_id:
        return jsonify({'messages': []})
    rows = db.execute("SELECT * FROM partner_messages WHERE user_id=? ORDER BY created_at DESC", (viewing_id,)).fetchall()
    return jsonify({'messages': [dict(r) for r in rows]})

@app.route('/api/partner-messages', methods=['POST'])
@require_auth
def send_partner_message():
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id=?", (g.current_user_id,)).fetchone()
    if user['role'] != 'girl':
        return jsonify({'error': '仅女生端可发送'}), 403
    data = request.get_json()
    message = data.get('message', '').strip()
    if not message:
        return jsonify({'error': '请输入消息'}), 400
    db.execute("INSERT INTO partner_messages (user_id,message) VALUES (?,?)", (g.current_user_id, message))
    db.commit()
    return jsonify({'ok': True})

# ====== Meals ======

@app.route('/api/meals', methods=['GET'])
@require_auth
def get_meals():
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id=?", (g.current_user_id,)).fetchone()
    viewing_id = g.current_user_id if user['role'] == 'girl' else user['bound_to_id']
    if not viewing_id:
        return jsonify({'meals': []})
    rows = db.execute("SELECT * FROM meals WHERE user_id=? ORDER BY date DESC", (viewing_id,)).fetchall()
    return jsonify({'meals': [dict(r) for r in rows]})

@app.route('/api/meals', methods=['POST'])
@require_auth
def save_meals():
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id=?", (g.current_user_id,)).fetchone()
    if user['role'] != 'girl':
        return jsonify({'error': '仅女生端可记录'}), 403
    data = request.get_json()
    meals = data.get('meals', [])
    db.execute("DELETE FROM meals WHERE user_id=?", (g.current_user_id,))
    for m in meals:
        db.execute("INSERT INTO meals (user_id,type,date,content,note,tags,photo) VALUES (?,?,?,?,?,?,?)",
                   (g.current_user_id, m.get('type', ''), m['date'], m.get('content', ''),
                    m.get('note', ''), json.dumps(m.get('tags', []), ensure_ascii=False),
                    m.get('photo', '')))
    db.commit()
    return jsonify({'ok': True})

# ====== Stats & AI ======

@app.route('/api/stats', methods=['GET'])
@require_auth
def get_stats():
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id=?", (g.current_user_id,)).fetchone()
    viewing_id = g.current_user_id if user['role'] == 'girl' else user['bound_to_id']
    if not viewing_id:
        return jsonify({'avgCycle': 28, 'avgPeriod': 5, 'confidence': 0})
    rows = db.execute("SELECT * FROM records WHERE user_id=? ORDER BY start_date ASC", (viewing_id,)).fetchall()
    records = [dict(r) for r in rows]
    # Calculate stats
    completed = [r for r in records if r.get('end_date')]
    cycles = []
    for i in range(len(completed) - 1):
        s1 = datetime.datetime.strptime(completed[i]['start_date'], '%Y-%m-%d')
        s2 = datetime.datetime.strptime(completed[i+1]['start_date'], '%Y-%m-%d')
        diff = (s2 - s1).days
        if 21 <= diff <= 45:
            cycles.append(diff)
    avg_cycle = round(sum(cycles)/len(cycles)) if cycles else 28
    p_lens = []
    for r in completed:
        s = datetime.datetime.strptime(r['start_date'], '%Y-%m-%d')
        e = datetime.datetime.strptime(r['end_date'], '%Y-%m-%d')
        pl = (e - s).days + 1
        if 2 <= pl <= 10:
            p_lens.append(pl)
    avg_period = round(sum(p_lens)/len(p_lens)) if p_lens else 5
    confidence = min(len(completed) / 3, 1) * 0.9

    # Next prediction
    last_start = None
    if records:
        last_start = datetime.datetime.strptime(sorted(records, key=lambda x: x['start_date'], reverse=True)[0]['start_date'], '%Y-%m-%d')
    predicted_next = (last_start + datetime.timedelta(days=avg_cycle)).strftime('%Y-%m-%d') if last_start else ''
    predicted_end = (datetime.datetime.strptime(predicted_next, '%Y-%m-%d') + datetime.timedelta(days=avg_period-1)).strftime('%Y-%m-%d') if predicted_next else ''

    return jsonify({
        'avgCycle': avg_cycle,
        'avgPeriod': avg_period,
        'confidence': round(confidence, 2),
        'predictedNextStart': predicted_next,
        'predictedNextEnd': predicted_end,
        'totalCycles': len(completed)
    })

@app.route('/api/ai-suggestions', methods=['GET'])
@require_auth
def get_ai_suggestions():
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id=?", (g.current_user_id,)).fetchone()
    viewing_id = g.current_user_id if user['role'] == 'girl' else user['bound_to_id']
    if not viewing_id:
        return jsonify({'suggestions': []})
    stats = json.loads(get_stats().data.decode())
    suggestions = []

    # Generate suggestions based on stats
    today = datetime.date.today()
    if stats.get('predictedNextStart'):
        next_start = datetime.datetime.strptime(stats['predictedNextStart'], '%Y-%m-%d').date()
        days_until = (next_start - today).days
        if 0 <= days_until <= 5:
            suggestions.append({'type': 'period_coming', 'title': '经期即将来临', 'text': f'预计 {days_until} 天后经期开始，建议提前准备卫生用品，注意保暖。'})
        elif days_until < 0:
            suggestions.append({'type': 'period_delay', 'title': '经期可能延迟', 'text': f'经期已延迟 {-days_until} 天，建议放松心情，避免焦虑。'})

    phase = 'luteal'
    if stats.get('predictedNextStart'):
        next_start = datetime.datetime.strptime(stats['predictedNextStart'], '%Y-%m-%d')
        ov_day = next_start - datetime.timedelta(days=14)
        luteal_start = ov_day + datetime.timedelta(days=3)
        now = datetime.datetime.now()
        if (next_start - now).days <= 0:
            phase = 'menstrual'
        elif (luteal_start - now).days <= 0:
            phase = 'luteal'
        elif (ov_day - now).days <= 3:
            phase = 'ovulation'
        else:
            phase = 'follicular'

    phase_tips = {
        'menstrual': {'title': '经期', 'text': '注意保暖，多喝温水，避免生冷食物和剧烈运动。可以适量补充铁质。'},
        'follicular': {'title': '卵泡期', 'text': '精力充沛，适合运动和学习新事物。皮肤状态较好，可以尝试新的护肤方案。'},
        'ovulation': {'title': '排卵期', 'text': '受孕几率较高期间。注意个人卫生，保持良好作息。'},
        'luteal': {'title': '黄体期', 'text': '可能出现情绪波动、乳房胀痛等症状。建议多吃富含维生素B的食物，减少盐分摄入。'}
    }
    if phase in phase_tips:
        suggestions.append({'type': 'phase', 'title': f'{phase_tips[phase]["title"]}期建议', 'text': phase_tips[phase]['text']})

    return jsonify({'suggestions': suggestions, 'currentPhase': phase})

# ====== Static Files ======

STATIC_DIR = os.path.dirname(os.path.abspath(__file__))

@app.route('/')
def serve_index():
    return send_from_directory(STATIC_DIR, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory(STATIC_DIR, path)

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok'})

# ====== Main ======

if __name__ == '__main__':
    init_db()
    port = int(os.environ.get('PORT', sys.argv[1] if len(sys.argv) > 1 else 8890))
    print(f"\n╔══════════════════════════════════════╗")
    print(f"║     乖宝生理期 - 服务器 v2.0         ║")
    print(f"╠══════════════════════════════════════╣")
    print(f"║  http://localhost:{port}              ║")
    print(f"║  手机访问: http://[电脑IP]:{port}     ║")
    print(f"╚══════════════════════════════════════╝")
    app.run(host='0.0.0.0', port=port, debug=False)
