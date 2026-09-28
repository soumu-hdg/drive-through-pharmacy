"""
SSK公式マスターCSV → JSON変換ツール
レセプト電算処理システム 基本マスター
https://www.ssk.or.jp/seikyushiharai/tensuhyo/kihonmasta/

Usage:
  python convert_ssk_csv.py --input-dir <SSK CSVディレクトリ> --output-dir <JSON出力先>

入力ファイル:
  s_ALL*.csv  - 医科診療行為マスター (S)
  y_ALL*.csv  - 医薬品マスター (Y)
  b_*.txt     - 傷病名マスター (B)
  z_*.txt     - 修飾語マスター (Z)

出力ファイル:
  s_procedures.json  - {コード: {name, pts, inout}}
  y_drugs.json       - {コード: {name, unit, price, generic}}
  b_diseases.json    - {コード: {name, icd10}}
  z_modifiers.json   - {コード: name}
"""
import csv
import json
import glob
import os
import argparse

def read_ssk(filepath):
    with open(filepath, 'r', encoding='shift_jis', errors='replace') as f:
        return list(csv.reader(f))

def strip(val):
    return val.strip('"').strip() if val else ''

def convert_s(rows):
    """医科診療行為マスター (S): 150項目/レコード"""
    result = {}
    for row in rows:
        if len(row) < 13:
            continue
        change = strip(row[0])
        if change == '9':  # 廃止
            continue
        code = strip(row[2])
        name = strip(row[4])
        pts = strip(row[11])  # 項番12: 新又は現点数
        inout = strip(row[12])  # 項番13: 入外適用区分
        if not code or not name:
            continue
        entry = {'name': name}
        if pts:
            try:
                entry['pts'] = int(pts)
            except ValueError:
                entry['pts'] = pts
        if inout:
            entry['inout'] = int(inout) if inout.isdigit() else inout
        result[code] = entry
    return result

def convert_y(rows):
    """医薬品マスター (Y): 42項目/レコード"""
    result = {}
    for row in rows:
        if len(row) < 17:
            continue
        change = strip(row[0])
        if change == '9':
            continue
        code = strip(row[2])
        name = strip(row[4])
        unit = strip(row[9])  # 項番10: 単位漢字名称
        price_raw = strip(row[11])  # 項番12: 新又は現金額
        generic = strip(row[16])  # 項番17: 後発品区分
        if not code or not name:
            continue
        entry = {'name': name}
        if unit:
            entry['unit'] = unit
        if price_raw:
            try:
                entry['price'] = round(int(price_raw) / 100, 2)
            except ValueError:
                pass
        if generic == '1':
            entry['g'] = 1  # 後発品フラグ (サイズ節約)
        result[code] = entry
    return result

def convert_b(rows):
    """傷病名マスター (B): 46項目/レコード"""
    result = {}
    for row in rows:
        if len(row) < 21:
            continue
        change = strip(row[0])
        if change == '9':
            continue
        code = strip(row[2])
        name = strip(row[5])  # 項番6: 基本名称
        icd10 = strip(row[15]) if len(row) > 15 else ''  # 項番16
        if not code or not name:
            continue
        entry = {'name': name}
        if icd10:
            entry['icd'] = icd10
        result[code] = entry
    return result

def convert_z(rows):
    """修飾語マスター (Z): 19項目/レコード"""
    result = {}
    for row in rows:
        if len(row) < 7:
            continue
        change = strip(row[0])
        if change == '9':
            continue
        code = strip(row[2])
        name = strip(row[6])  # 項番7: 名称
        if not code or not name:
            continue
        result[code] = name
    return result

def main():
    parser = argparse.ArgumentParser(description='SSK CSV to JSON converter')
    parser.add_argument('--input-dir', default=r'C:\ClaudeWork\_tmp_ssk_csv',
                        help='Directory containing SSK CSV files')
    parser.add_argument('--output-dir', default=None,
                        help='Output directory for JSON files (default: ../master/)')
    args = parser.parse_args()

    if args.output_dir is None:
        args.output_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'master')

    os.makedirs(args.output_dir, exist_ok=True)

    conversions = [
        ('s_ALL*.csv', convert_s, 's_procedures.json', 'S_診療行為'),
        ('y_ALL*.csv', convert_y, 'y_drugs.json', 'Y_医薬品'),
        ('b_*.txt', convert_b, 'b_diseases.json', 'B_傷病名'),
        ('z_*.txt', convert_z, 'z_modifiers.json', 'Z_修飾語'),
    ]

    for pattern, converter, out_name, label in conversions:
        files = glob.glob(os.path.join(args.input_dir, pattern))
        if not files:
            print(f'  {label}: File not found ({pattern})')
            continue
        filepath = sorted(files)[-1]  # 最新ファイル
        print(f'  {label}: {os.path.basename(filepath)}', end='')
        rows = read_ssk(filepath)
        data = converter(rows)
        out_path = os.path.join(args.output_dir, out_name)
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        size_kb = os.path.getsize(out_path) / 1024
        print(f' -> {len(data)} entries ({size_kb:.0f}KB)')

    print('Done.')

if __name__ == '__main__':
    main()
