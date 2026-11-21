from lib import *
import json
out={}
for i in range(1,10):
    c=detect(i); out[i]=c[:3]; print(i,['%.1f'%v for v in c])
json.dump(out,open('circles.json','w'))
