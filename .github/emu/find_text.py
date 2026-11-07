# 덤프에서 특정 resource 클래스(EditText)의 text 출력
import sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
for n in root.iter('node'):
    if n.get('class') == 'android.widget.EditText':
        print(repr(n.get('text')))
