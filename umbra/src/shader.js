import { N, C, W, HMAX } from './city.js'

export const RT = 512 // route-texture resolution

export const VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`

export const FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
#define N ${N}
#define C ${C.toFixed(1)}
#define W ${W.toFixed(1)}
#define HMAX ${HMAX.toFixed(1)}
#define RT ${RT}
out vec4 outColor;

uniform sampler2D uMap;    // r=height g=material b=id
uniform sampler2D uRoute;  // r=short mask g=short progress b=cool mask a=cool progress
uniform vec2 uRes;
uniform vec3 uCam, uF, uR, uU;
uniform float uTan, uAspect, uTime;
uniform vec3 uSun;     // where the sun really is
uniform vec3 uL;       // direction of the light actually used (sun by day, moon by night)
uniform vec3 uLCol;    // its colour * intensity
uniform float uDay;    // 0 night .. 1 day
uniform float uTw;     // twilight amount
uniform float uSunStr; // 0..1 how hot the sun is
uniform float uThermal;
uniform vec2 uLen;     // route lengths (m)

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float hash13(vec3 p3){ p3 = fract(p3*.1031); p3 += dot(p3,p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }

vec3 inferno(float x){
  x = clamp(x,0.,1.);
  const vec3 c0=vec3(0.0002189,0.0016510,-0.0194809), c1=vec3(0.1065134,0.5639564,3.9327124),
    c2=vec3(11.6024931,-3.9728540,-15.9423941), c3=vec3(-41.7039961,17.4363989,44.3541452),
    c4=vec3(77.1629357,-33.4023589,-81.8073093), c5=vec3(-71.3194282,32.6260643,73.2095199),
    c6=vec3(25.1311262,-12.2426690,-23.0703250);
  return clamp(c0+x*(c1+x*(c2+x*(c3+x*(c4+x*(c5+x*c6))))),0.,1.);
}

vec3 skyBase(vec3 rd){
  vec3 zenD=vec3(0.13,0.36,0.80), horD=vec3(0.66,0.80,0.95);
  vec3 zenN=vec3(0.004,0.008,0.028), horN=vec3(0.025,0.035,0.08);
  vec3 zen=mix(zenN,zenD,uDay), hor=mix(horN,horD,uDay);
  vec2 hs = normalize(uSun.xz+1e-5), hr = normalize(rd.xz+1e-5);
  float towardSun = pow(max(dot(hs,hr),0.),3.0);
  hor = mix(hor, vec3(1.0,0.42,0.16), uTw*(0.25+0.75*towardSun));
  zen = mix(zen, vec3(0.20,0.18,0.42), uTw*0.45);
  float hz = pow(1.0-clamp(rd.y,0.,1.),3.2);
  return mix(zen,hor,hz);
}

vec3 sky(vec3 rd){
  vec3 col = skyBase(rd);
  float sd = max(dot(rd,uSun),0.);
  vec3 sc = mix(vec3(1.0,0.5,0.22),vec3(1.0,0.95,0.85),smoothstep(0.,0.3,uSun.y));
  col += sc*(pow(sd,900.)*40. + pow(sd,12.)*0.35 + pow(sd,3.)*0.06)*smoothstep(-0.12,0.05,uSun.y);
  float night = 1.-uDay;
  if (rd.y>0.0 && night>0.01){
    vec3 g = floor(rd*260.);
    float s = hash13(g);
    float tw = 0.6+0.4*sin(uTime*2.+s*40.);
    col += vec3(0.8,0.85,1.0)*step(0.9965,s)*tw*night*smoothstep(0.,0.15,rd.y);
    vec3 md = -uSun;
    float m = dot(rd,md);
    col += vec3(0.85,0.9,1.0)*smoothstep(0.9993,0.9996,m)*night*1.4 + vec3(0.3,0.4,0.7)*pow(max(m,0.),60.)*0.15*night;
  }
  return col;
}

bool traceGrid(vec3 ro, vec3 rd, int maxIter, out float tHit, out vec3 nrm, out ivec2 cellHit){
  vec2 d = rd.xz;
  d.x = abs(d.x)<1e-6 ? 1e-6 : d.x;
  d.y = abs(d.y)<1e-6 ? 1e-6 : d.y;
  vec2 t1 = (vec2(0.)-ro.xz)/d, t2 = (vec2(W)-ro.xz)/d;
  vec2 tn = min(t1,t2), tf = max(t1,t2);
  float tEnter = max(max(tn.x,tn.y),0.);
  float tExitBox = min(tf.x,tf.y);
  if (ro.y>HMAX){ if (rd.y>=0.) return false; tEnter = max(tEnter,(HMAX-ro.y)/rd.y); }
  if (tEnter>=tExitBox) return false;
  float t = tEnter+1e-3;
  vec3 p = ro+rd*t;
  ivec2 cell = ivec2(clamp(floor(p.xz/C),vec2(0.),vec2(float(N-1))));
  ivec2 stp = ivec2(d.x>0.?1:-1, d.y>0.?1:-1);
  vec2 tDelta = C/abs(d);
  vec2 nb = (vec2(cell)+vec2(d.x>0.?1.:0., d.y>0.?1.:0.))*C;
  vec2 tMax = (nb-ro.xz)/d;
  int last = -1;
  for (int i=0;i<maxIter;i++){
    float h = texelFetch(uMap,cell,0).r;
    float yIn = ro.y+rd.y*t;
    if (yIn<=h){
      tHit=t; cellHit=cell;
      nrm = last==0 ? vec3(-float(stp.x),0.,0.) : (last==1 ? vec3(0.,0.,-float(stp.y)) : vec3(0.,1.,0.));
      return true;
    }
    float tExit = min(tMax.x,tMax.y);
    float yOut = ro.y+rd.y*tExit;
    if (yOut<h){ tHit=(h-ro.y)/rd.y; nrm=vec3(0.,1.,0.); cellHit=cell; return true; }
    if (tMax.x<tMax.y){ t=tMax.x; tMax.x+=tDelta.x; cell.x+=stp.x; last=0; }
    else { t=tMax.y; tMax.y+=tDelta.y; cell.y+=stp.y; last=1; }
    if (cell.x<0||cell.y<0||cell.x>=N||cell.y>=N) return false;
    if (rd.y>0. && ro.y+rd.y*t>HMAX) return false;
  }
  return false;
}

float shadowRay(vec3 ro, vec3 L){
  if (L.y<=0.003) return 0.;
  vec2 d = L.xz;
  d.x = abs(d.x)<1e-6 ? 1e-6 : d.x;
  d.y = abs(d.y)<1e-6 ? 1e-6 : d.y;
  ivec2 cell = ivec2(floor(ro.xz/C));
  if (cell.x<0||cell.y<0||cell.x>=N||cell.y>=N) return 1.;
  ivec2 stp = ivec2(d.x>0.?1:-1, d.y>0.?1:-1);
  vec2 tDelta = C/abs(d);
  vec2 nb = (vec2(cell)+vec2(d.x>0.?1.:0., d.y>0.?1.:0.))*C;
  vec2 tMax = (nb-ro.xz)/d;
  float res = 1.;
  for (int i=0;i<300;i++){
    float t;
    if (tMax.x<tMax.y){ t=tMax.x; tMax.x+=tDelta.x; cell.x+=stp.x; }
    else { t=tMax.y; tMax.y+=tDelta.y; cell.y+=stp.y; }
    if (cell.x<0||cell.y<0||cell.x>=N||cell.y>=N) break;
    float y = ro.y+L.y*t;
    if (y>HMAX) break;
    float h = texelFetch(uMap,cell,0).r;
    if (h>0.5){
      res = min(res,(y-h)*22./(t+3.));
      if (res<=0.) return 0.;
    }
  }
  return clamp(res,0.,1.);
}

vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.,1.); }

void main(){
  vec2 uv = (gl_FragCoord.xy/uRes)*2.-1.;
  vec3 rd = normalize(uF + uR*(uv.x*uTan*uAspect) + uU*(uv.y*uTan));
  vec3 col;
  float t; vec3 n; ivec2 cell;
  bool hit = traceGrid(uCam,rd,280,t,n,cell);
  vec3 fogCol = skyBase(normalize(vec3(rd.x,0.02,rd.z)));
  float tDist = 0.;
  if (hit){
    vec3 p = uCam+rd*t;
    tDist = t;
    vec4 m = texelFetch(uMap,cell,0);
    float h = m.r; int mat = int(m.g+0.5); float bid = m.b;
    float ndl = max(dot(n,uL),0.);
    float vis = ndl>0. ? shadowRay(p+n*0.06,uL) : 0.;
    vec3 direct = uLCol*ndl*vis;
    vec3 ambCol = mix(vec3(0.02,0.03,0.06),vec3(0.30,0.38,0.52),uDay);
    ambCol = mix(ambCol, vec3(0.38,0.26,0.30), uTw*0.5);
    vec3 amb = ambCol*(0.55+0.45*n.y);
    vec3 alb = vec3(0.5);
    vec3 emis = vec3(0.);
    float heatBase = 0.2;
    vec2 q = p.xz;
    bool water = false;
    if (mat==1){
      float hh = hash12(vec2(bid,7.));
      vec3 wall = mix(vec3(0.62,0.58,0.52),vec3(0.42,0.27,0.22),step(0.72,hh));
      wall = mix(wall,vec3(0.45,0.52,0.58),step(0.5,hh)*step(hh,0.72));
      wall = mix(wall,vec3(0.72,0.70,0.66),step(0.86,hh)*step(hh,0.95));
      if (n.y>0.5){
        alb = vec3(0.30,0.30,0.32)*(0.8+0.4*hash12(floor(q/3.)));
        vec2 f = fract(q/C); float e = min(min(f.x,1.-f.x),min(f.y,1.-f.y));
        alb *= 0.8+0.5*smoothstep(0.1,0.02,e);
        heatBase = 0.22;
      } else {
        float u = abs(n.x)>0.5 ? p.z : p.x;
        float v = p.y;
        vec2 wc = vec2(u/3.2, v/3.6);
        vec2 wf = fract(wc);
        float win = step(0.18,wf.x)*step(wf.x,0.82)*step(0.2,wf.y)*step(wf.y,0.78)*step(4.0,v);
        float lit = step(0.62,hash13(vec3(bid,floor(wc))));
        alb = mix(wall,vec3(0.07,0.10,0.15),win);
        float ao = mix(0.5,1.,smoothstep(0.,16.,p.y));
        alb *= ao; amb *= ao;
        emis = vec3(1.0,0.78,0.45)*win*lit*(1.-uDay)*1.6;
        // glassy sky sheen on windows by day
        emis += win*uDay*skyBase(reflect(rd,n))*0.18;
        heatBase = 0.2;
      }
    } else if (mat==3){
      float hh = hash12(vec2(cell)+3.);
      alb = mix(vec3(0.07,0.22,0.06),vec3(0.16,0.36,0.09),hh)*(n.y>0.5?1.:0.7);
      heatBase = 0.1;
    } else if (mat==2){
      alb = mix(vec3(0.09,0.25,0.07),vec3(0.14,0.30,0.08),hash12(floor(q*0.7)));
      heatBase = 0.12;
    } else if (mat==4){
      vec2 f = abs(fract(q/1.8)-0.5);
      alb = vec3(0.58,0.54,0.47)*(0.9+0.12*hash12(floor(q/1.8)))*(1.-0.25*step(0.47,max(f.x,f.y)));
      heatBase = 0.26;
    } else if (mat==5 || mat==7){
      vec2 f = abs(fract(q/1.5)-0.5);
      float g = step(0.47,max(f.x,f.y));
      alb = (mat==7?vec3(0.30,0.29,0.28):vec3(0.46,0.44,0.40))*(0.92+0.1*hash12(floor(q/1.5)))*(1.-0.3*g);
      heatBase = 0.27;
    } else if (mat==6){
      water = true;
      alb = vec3(0.02,0.06,0.09);
      heatBase = 0.02;
    } else {
      alb = vec3(0.065,0.065,0.072)*(0.85+0.3*hash12(floor(q*0.8)));
      // dashed centre lines on road cells
      vec2 cc = fract(q/C);
      heatBase = 0.3;
    }
    vec3 lamp = vec3(0.);
    if (n.y>0.5 && h<1. && uDay<0.6){
      float night = 1.-uDay;
      vec2 base = floor(q/C);
      for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++){
        vec2 c2 = base+vec2(float(i),float(j));
        if (c2.x<0.||c2.y<0.||c2.x>=float(N)||c2.y>=float(N)) continue;
        float sel = hash12(c2*1.7);
        if (sel>0.14) continue;
        int mm = int(texelFetch(uMap,ivec2(c2),0).g+0.5);
        if (mm!=5) continue;
        vec2 ctr = (c2+0.5)*C;
        float dd = length(q-ctr);
        lamp += vec3(1.0,0.72,0.38)*exp(-dd*dd/(2.*7.5*7.5))*0.55*night;
      }
    }
    if (water){
      vec3 nn = normalize(vec3(sin(p.x*0.7+uTime*0.8)*0.05+sin(p.z*1.9-uTime*1.3)*0.025, 1., sin(p.z*0.6-uTime*0.7)*0.05+sin(p.x*2.1+uTime*1.1)*0.025));
      vec3 refl = reflect(rd,nn);
      float fr = pow(1.-max(dot(-rd,nn),0.),4.);
      col = alb*(amb*0.6+direct*0.15) + mix(0.04,0.9,fr)*skyBase(refl);
      vec3 hv = normalize(uL-rd);
      float sp = pow(max(dot(nn,hv),0.),420.)*vis*step(0.003,uL.y);
      col += uLCol*sp*2.5 + lamp*0.25;
    } else {
      col = alb*(direct+amb) + emis + alb*lamp*3.0 + lamp*0.12;
    }
    // route overlay (ground only)
    if (n.y>0.5 && h<1.){
      ivec2 rt = ivec2(clamp(floor(p.xz/W*float(RT)),vec2(0.),vec2(float(RT-1))));
      vec4 r = texelFetch(uRoute,rt,0);
      float pulseS = smoothstep(0.55,1.0,fract(r.g*uLen.x/36.-uTime*0.9));
      float pulseC = smoothstep(0.55,1.0,fract(r.a*uLen.y/36.-uTime*0.9));
      vec3 cS = vec3(1.0,0.50,0.16), cC = vec3(0.25,1.0,0.78);
      col += cS*r.r*(0.55+1.4*pulseS)*0.8;
      col = mix(col,col*0.5,r.b*0.5);
      col += cC*r.b*(0.7+1.6*pulseC)*0.9;
    }
    // thermal vision
    if (uThermal>0.5){
      float heat = heatBase*0.7 + 0.14 + 0.78*ndl*vis*uSunStr*(heatBase*2.4+0.2) + 0.1*uDay;
      if (water) heat = 0.06+0.05*uDay;
      if (mat==1 && n.y<0.5) heat = 0.12+0.5*ndl*vis*uSunStr;
      vec3 th = inferno(heat);
      if (n.y>0.5 && h<1.){
        ivec2 rt = ivec2(clamp(floor(p.xz/W*float(RT)),vec2(0.),vec2(float(RT-1))));
        vec4 r = texelFetch(uRoute,rt,0);
        th = mix(th, vec3(1.,0.55,0.16), r.r*0.9);
        th = mix(th, vec3(0.25,1.0,0.85), r.b*0.95);
      }
      col = th*1.15;
    }
  } else {
    if (rd.y<0.){
      // beyond the city: ground fading into the horizon
      float tg = -uCam.y/rd.y;
      tDist = tg;
      vec3 gp = uCam+rd*tg;
      col = mix(vec3(0.03,0.035,0.04),vec3(0.07,0.075,0.08),0.5)*mix(0.15,1.,uDay);
      if (uThermal>0.5) col = inferno(0.18)*0.8;
    } else {
      col = sky(rd);
      tDist = 0.;
      if (uThermal>0.5) col = mix(vec3(0.02,0.0,0.05),vec3(0.14,0.03,0.2),pow(1.-rd.y,3.));
    }
  }
  if (tDist>0.){
    float f = 1.-exp(-tDist*0.00022);
    if (!hit) f = clamp(f*1.4+0.2,0.,1.);
    col = mix(col, uThermal>0.5?vec3(0.04,0.0,0.08):fogCol, f);
  }
  col = aces(col*1.05);
  col = pow(col,vec3(1./2.2));
  // gentle vignette
  vec2 vq = uv*0.5;
  col *= 1.-0.35*dot(vq,vq);
  outColor = vec4(col,1.);
}`
