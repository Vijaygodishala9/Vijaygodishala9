from flask import Flask, jsonify, request
from flask_cors import CORS
import requests

app = Flask(__name__)
CORS(app)  # Allow all browser origins

API_KEY  = "b229907d-774f-4846-aa97-4c4da448a85a"
BASE_URL = "https://cricket.highlightly.net"
HEADERS  = {"x-rapidapi-key": API_KEY}

@app.route("/api/matches")
def matches():
    date     = request.args.get("date", "2026-05-05")
    timezone = request.args.get("timezone", "Etc/UTC")
    limit    = request.args.get("limit", "100")
    r = requests.get(f"{BASE_URL}/matches", params={"date": date, "timezone": timezone, "limit": limit}, headers=HEADERS)
    return jsonify(r.json()), r.status_code

@app.route("/api/match/<match_id>")
def match_detail(match_id):
    r = requests.get(f"{BASE_URL}/matches/{match_id}", headers=HEADERS)
    return jsonify(r.json()), r.status_code

@app.route("/api/scorecard/<match_id>")
def scorecard(match_id):
    r = requests.get(f"{BASE_URL}/scorecard", params={"matchId": match_id}, headers=HEADERS)
    return jsonify(r.json()), r.status_code

@app.route("/api/scoreboard/<match_id>")
def scoreboard(match_id):
    r = requests.get(f"{BASE_URL}/scoreboard", params={"matchId": match_id}, headers=HEADERS)
    return jsonify(r.json()), r.status_code

@app.route("/api/commentary/<match_id>")
def commentary(match_id):
    r = requests.get(f"{BASE_URL}/commentary", params={"matchId": match_id}, headers=HEADERS)
    return jsonify(r.json()), r.status_code

if __name__ == "__main__":
    print("✓ Cricket proxy running at http://localhost:5000")
    app.run(port=5000, debug=False)
