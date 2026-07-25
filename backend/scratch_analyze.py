import os, glob
import ezdxf

sample_dir = r'C:\Users\rosha\Desktop\Cadanest\sample\Upravljacka jedinica\Razvijene povrsine pozicija dxf - file'
dxf_files = glob.glob(os.path.join(sample_dir, '*.dxf'))
print(f'Found {len(dxf_files)} DXF files')

for fpath in dxf_files:
    fname = os.path.basename(fpath)
    try:
        doc = ezdxf.readfile(fpath)
        msp = doc.modelspace()
        layers = set(e.dxf.layer for e in msp)
        entity_types = {}
        for e in msp:
            t = e.dxftype()
            entity_types[t] = entity_types.get(t, 0) + 1
        print(f'=== {fname} ===')
        print(f'  Layers: {layers}')
        print(f'  Entities: {entity_types}')
        
        # Check text/mtext annotations
        texts = [e.dxf.text for e in msp.query('TEXT')] + [e.text for e in msp.query('MTEXT')]
        if texts:
            print(f'  Texts/Annotations: {texts[:10]}')
    except Exception as err:
        print(f'  Error loading {fname}: {err}')
