```
python3 -m venv .env
source .env/bin/activate
```

dev:

```
pip3 install -r requirements.txt
uvicorn main:app --reload
```

You can now play with api on port `:8000`