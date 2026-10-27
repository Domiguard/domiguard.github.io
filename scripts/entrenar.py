#!/usr/bin/env python3
"""Reentrena el modelo de Domiguard y escribe web/model.json.

Base: data/phishing_dataset.csv (las 88,647 URLs del Excel, hoja Structured data 5).
Opcional: --nuevos archivo.csv  (el CSV que descarga el Monitor, solo phishing).
Opcional: --legitimos archivo.csv (mismo formato de 15 columnas, phishing = 0).

Requiere: pip install pandas scikit-learn
OJO: los sitios nuevos del Monitor son todos phishing y no traen antigüedad (-1).
Si se agregan solos, el modelo aprende que "sin dato" es sospechoso. Por eso conviene
sumar también --legitimos con la misma proporción de datos desconocidos.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.model_selection import train_test_split

RAIZ = Path(__file__).resolve().parent.parent
FEATURES = ["len_log", "dots", "hyph", "under", "at", "dom_len", "ip",
            "age_unk", "age_log", "ssl", "redir", "short"]


def variables(df):
    return pd.DataFrame({
        "len_log": np.log1p(df.length_url),
        "dots": df.qty_dot_url.clip(0, 10),
        "hyph": df.qty_hyphen_url.clip(0, 10),
        "under": df.qty_underline_url.clip(0, 10),
        "at": (df.qty_at_url > 0).astype(int),
        "dom_len": df.domain_length.clip(0, 60),
        "ip": df.domain_in_ip,
        "age_unk": (df.time_domain_activation < 0).astype(int),
        "age_log": np.where(df.time_domain_activation < 0, 0,
                            np.log1p(df.time_domain_activation.clip(lower=0))),
        "ssl": df.tls_ssl_certificate,
        "redir": df.qty_redirects.clip(0, 5),
        "short": df.url_shortened,
    })[FEATURES]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nuevos")
    ap.add_argument("--legitimos")
    a = ap.parse_args()

    df = pd.read_csv(RAIZ / "data" / "phishing_dataset.csv")
    cols = list(df.columns)
    for extra in (a.nuevos, a.legitimos):
        if extra:
            e = pd.read_csv(extra)[cols]
            df = pd.concat([df, e], ignore_index=True)
    print("Filas:", len(df), " phishing:", int(df.phishing.sum()))

    X, y = variables(df), df.phishing
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=42, stratify=y)
    mu, sd = Xtr.mean(), Xtr.std()
    m = LogisticRegression(max_iter=3000).fit((Xtr - mu) / sd, ytr)
    p = m.predict_proba((Xte - mu) / sd)[:, 1]
    auc, acc = roc_auc_score(yte, p), accuracy_score(yte, p > 0.5)
    print(f"AUC {auc:.3f}  exactitud {acc:.3f}  (30% reservado)")

    mu, sd = X.mean(), X.std()
    m = LogisticRegression(max_iter=3000).fit((X - mu) / sd, y)
    salida = {
        "features": FEATURES,
        "mu": mu.round(6).tolist(), "sd": sd.round(6).tolist(),
        "coef": m.coef_[0].round(6).tolist(), "b": float(m.intercept_[0]),
        "auc": round(float(auc), 4), "acc": round(float(acc), 4),
        "entrenado_con": f"{len(df):,} URLs",
    }
    (RAIZ / "web" / "model.json").write_text(json.dumps(salida, indent=1), encoding="utf-8")
    print("Escrito web/model.json")


if __name__ == "__main__":
    main()
