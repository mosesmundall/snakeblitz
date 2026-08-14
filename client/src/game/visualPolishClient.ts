import Phaser from "phaser";
import { GameScene } from "./GameScene";
import { network } from "../network";
import type { GameSnapshot, SnakeSnapshot } from "../types";

// Lightweight visual polish. Special snakes are still ONE cached Image each.
// Tank upgrades are baked into TWO reusable Graphics overlays that redraw only
// when an upgrade level changes. No extra physics bodies or network traffic.
const p=GameScene.prototype as any;

const POLISHED_VARIANTS=new Set([
  "BOMBER","VENOM","CASH","GOLDEN","HEALER","RATTLER","ARMOURED","CHARGER","ALPHA",
  "TANK","BERSERKER","VENOM_CONTACT","SHIELD","PHASE","PREDATOR","EXPLOSIVE",
]);

const palette:Record<string,{body:number[];head:number;outline:number;accent:number}>={
  NORMAL:{body:[0x365c32,0x3f6938,0x487442],head:0x558c4d,outline:0x17361b,accent:0x86ad72},
  BOMBER:{body:[0x6f362d,0x8a4534,0x9e523b],head:0xaa503b,outline:0x452018,accent:0xff9a37},
  VENOM:{body:[0x2e5d50,0x397665,0x438675],head:0x4c9480,outline:0x173d34,accent:0x84e6bd},
  CASH:{body:[0x75662f,0x91813b,0xa89142],head:0xb19c4d,outline:0x54471d,accent:0xffd35f},
  GOLDEN:{body:[0x8e6925,0xc39132,0xe6b94f],head:0xf0ca62,outline:0x604313,accent:0xffef9a},
  HEALER:{body:[0x2f7046,0x41975c,0x55b970],head:0x66ce7e,outline:0x1c4a2c,accent:0xc8ffda},
  RATTLER:{body:[0x725137,0x93694a,0xb18459],head:0xb98a61,outline:0x4e3423,accent:0xf2d08f},
  ARMOURED:{body:[0x596269,0x707b83,0x89949b],head:0x929da3,outline:0x30373c,accent:0xd5dde0},
  CHARGER:{body:[0x71332d,0xa84437,0xcf5846],head:0xe26750,outline:0x4c201c,accent:0xffc36b},
  ALPHA:{body:[0x56365f,0x744582,0x9254a2],head:0xa86ab8,outline:0x35203b,accent:0xe8a9ff},
  TANK:{body:[0x424a45,0x59625c,0x6f7871],head:0x778179,outline:0x252a27,accent:0xc1c9c2},
  BERSERKER:{body:[0x652824,0x913630,0xbf453b],head:0xd04e43,outline:0x411816,accent:0xffb257},
  VENOM_CONTACT:{body:[0x32683a,0x438c4b,0x56aa5e],head:0x64bd6b,outline:0x204525,accent:0xb4ff83},
  SHIELD:{body:[0x356b78,0x478fa0,0x58aebe],head:0x69c3d2,outline:0x234850,accent:0xc8f5ff},
  PHASE:{body:[0x5e4975,0x7d61a0,0x9978c0],head:0xab8bd2,outline:0x3c2c4f,accent:0xe0c9ff},
  PREDATOR:{body:[0x70412b,0x9b5737,0xc66f43],head:0xd47d4b,outline:0x462719,accent:0xffc67e},
  EXPLOSIVE:{body:[0x754426,0xa65d2f,0xd27836],head:0xe4863d,outline:0x4a2918,accent:0xffd06a},
};

function q(v:number,step:number,min:number){return Math.max(min,Math.round(v/step)*step);}
function plus(g:Phaser.GameObjects.Graphics,x:number,y:number,size:number,c:number){
  g.fillStyle(c,.94);g.fillRect(x-size*.17,y-size*.52,size*.34,size*1.04);g.fillRect(x-size*.52,y-size*.17,size*1.04,size*.34);
}

function makePolishedSnakeTexture(scene:any,snake:SnakeSnapshot){
  const variant=String((snake as any).variant??"NORMAL");
  // Coarse size buckets greatly reduce the number of GPU textures accumulated
  // across a long run. Visual mismatch is only a few pixels and is intentional.
  const hr=q(snake.headRadius,4,8),br=q(snake.bodyRadius,4,8),len=q(snake.length,16,64);
  const rattleExtra=variant==="RATTLER"?40:0;
  const key=`sb-polish-${variant}-${snake.volatile?1:0}-${hr}-${br}-${len}`;
  const margin=14,headX=margin+rattleExtra+len;
  const width=Math.ceil(rattleExtra+len+hr*2+margin*2+8);
  const height=Math.ceil(Math.max(hr*2.4,br*3.3)+margin*2);
  const originX=headX/width;
  if(scene.textures.exists(key))return{key,originX};

  const c=palette[variant]??palette.NORMAL;
  const g=scene.make.graphics({x:0,y:0},false),cy=height/2;

  g.fillStyle(0x07100b,.22);g.fillEllipse(headX-len*.43+5,cy+7,len*.92,br*2.05);

  if(variant==="RATTLER"){
    const base=headX-len+2;
    for(let i=0;i<5;i++){
      const x=base-6-i*6.8,sz=Math.max(5,8.5-i*.6);
      g.fillStyle(i%2?0xd7b371:0x89633b,1);g.fillEllipse(x,cy+(i%2?1.5:-1.5),sz*1.35,sz);
      g.lineStyle(1.3,0x49311e,.9);g.strokeEllipse(x,cy+(i%2?1.5:-1.5),sz*1.35,sz);
    }
    g.fillStyle(0xead18f,.95);g.fillTriangle(base-42,cy,base-34,cy-4.5,base-34,cy+4.5);
  }

  // Six baked body segments instead of seven: same silhouette, fewer raster ops.
  const segments=6,spacing=len/segments;
  for(let i=segments;i>=1;i--){
    const taper=Phaser.Math.Linear(.44,1,1-i/(segments+1));
    const r=Math.max(5,br*taper),x=headX-spacing*i,y=cy+Math.sin(i*.9)*br*.20;
    if(variant==="PHASE"){g.fillStyle(0xc7a7ec,.11);g.fillCircle(x-4,y+3,r*1.15);}
    g.fillStyle(c.body[i%c.body.length],1);g.fillCircle(x,y,r);g.lineStyle(1.8,c.outline,.62);g.strokeCircle(x,y,r);

    if((snake.volatile||variant==="BOMBER"||variant==="EXPLOSIVE")&&(i===2||i===4||i===6)){
      g.fillStyle(0xff9a37,.9);g.fillCircle(x,y,Math.max(3.5,r*.41));g.lineStyle(1,0xffe08a,.8);g.strokeCircle(x,y,Math.max(3.5,r*.41));
    }
    if(variant==="ARMOURED"||variant==="TANK"){
      g.fillStyle(0xc5cdd0,.26);g.fillRoundedRect(x-r*.76,y-r*.45,r*1.52,r*.68,3);g.lineStyle(1,0x22292c,.72);g.strokeRoundedRect(x-r*.76,y-r*.45,r*1.52,r*.68,3);
    }
    if(variant==="HEALER"&&(i===2||i===5))plus(g,x,y,Math.max(7,r*.78),0xd7ffe2);
    if(variant==="BERSERKER"&&(i===2||i===4||i===6)){g.lineStyle(2,0xff9a58,.76);g.lineBetween(x-r*.5,y+r*.4,x+r*.45,y-r*.42);}
    if(variant==="PREDATOR"&&(i===2||i===4||i===6)){g.lineStyle(2.5,0x2b2119,.68);g.lineBetween(x-r*.5,y-r*.55,x+r*.22,y+r*.5);}
    if(variant==="VENOM_CONTACT"&&(i===2||i===4||i===6)){g.fillStyle(0xb8ff83,.68);g.fillCircle(x,y+r*.14,Math.max(3,r*.29));}
    if(variant==="GOLDEN"&&(i===2||i===5)){g.fillStyle(0xfff1a6,.88);g.fillTriangle(x,y-r*.65,x-r*.3,y,x+r*.3,y);}
  }

  g.fillStyle(c.body[1]??c.head,1);g.fillCircle(headX-hr*.62,cy,Math.max(br,hr*.54));

  if(variant==="VENOM"||variant==="VENOM_CONTACT"){
    g.fillStyle(c.accent,.23);g.fillEllipse(headX-hr*.36,cy,hr*1.4,hr*2.02);
  }
  if(variant==="SHIELD"){g.lineStyle(3.5,c.accent,.45);g.strokeEllipse(headX-hr*.18,cy,hr*2.45,hr*2.05);}

  g.fillStyle(c.head,1);g.fillEllipse(headX,cy,hr*2,hr*1.55);g.lineStyle(2.5,c.outline,.84);g.strokeEllipse(headX,cy,hr*2,hr*1.55);
  g.fillStyle(c.accent,.20);g.fillEllipse(headX+hr*.2,cy,hr*.92,hr*1.06);

  if(variant==="CHARGER"){
    g.fillStyle(0xffc36b,.94);
    g.fillTriangle(headX+hr*.55,cy-hr*.48,headX+hr*1.28,cy-hr*.66,headX+hr*.75,cy-hr*.12);
    g.fillTriangle(headX+hr*.55,cy+hr*.48,headX+hr*1.28,cy+hr*.66,headX+hr*.75,cy+hr*.12);
  }
  if(variant==="ALPHA"){
    g.fillStyle(0xe8a9ff,.74);
    for(let i=1;i<=3;i++){const x=headX-len*(i/4);g.fillTriangle(x,cy-br*.68,x-6,cy-br*1.42,x+6,cy-br*.68);}
  }
  if(variant==="HEALER"){g.lineStyle(2.5,0xc8ffda,.72);g.strokeCircle(headX-hr*.15,cy,hr);plus(g,headX-hr*.15,cy,Math.max(9,hr*.64),0xe7fff0);}
  if(variant==="GOLDEN"){g.lineStyle(2.5,0xffef9a,.78);g.strokeCircle(headX,cy,hr*1.02);}
  if(variant==="PHASE"){g.lineStyle(2,0xe0c9ff,.48);g.strokeEllipse(headX-4,cy+3,hr*2.1,hr*1.68);}
  if(variant==="EXPLOSIVE"){g.lineStyle(2.5,0xffd06a,.78);g.strokeCircle(headX-hr*.1,cy,hr*.6);g.lineBetween(headX-hr*.5,cy-hr*.4,headX+hr*.3,cy+hr*.4);g.lineBetween(headX-hr*.5,cy+hr*.4,headX+hr*.3,cy-hr*.4);}

  const ey=hr*.3,ex=hr*.28;
  for(const sign of [-1,1]){
    g.fillStyle(variant==="BERSERKER"?0xffcf6b:0xf5e6bd,1);g.fillCircle(headX+ex,cy+ey*sign,Math.max(3,hr*.16));
    g.fillStyle(0x11180f,1);g.fillCircle(headX+ex+hr*.07,cy+ey*sign,Math.max(1.6,hr*.07));
  }
  g.lineStyle(2,0xe45d66,.76);g.lineBetween(headX+hr*.82,cy,headX+hr*1.27,cy);g.lineBetween(headX+hr*1.16,cy,headX+hr*1.35,cy-4);g.lineBetween(headX+hr*1.16,cy,headX+hr*1.35,cy+4);

  if(variant==="CASH"){
    const bx=headX-len*.42;g.fillStyle(0xffd35f,.96);g.fillRoundedRect(bx-10,cy-br-14,20,16,3);g.lineStyle(2,0x6b4a20,.82);g.strokeRoundedRect(bx-10,cy-br-14,20,16,3);
  }

  g.generateTexture(key,width,height);g.destroy();
  return{key,originX};
}

if(!p.__optimizedVisualPolishInstalled){
  p.__optimizedVisualPolishInstalled=true;

  const originalEnsure=p.ensureSnakeTexture;
  p.ensureSnakeTexture=function(snake:SnakeSnapshot){
    const variant=String((snake as any).variant??"NORMAL");
    return POLISHED_VARIANTS.has(variant)?makePolishedSnakeTexture(this,snake):originalEnsure.call(this,snake);
  };

  // Phase 2/3 layers use tints for class identification. The new textures carry
  // that identity themselves, so clear the tint to preserve the new markings.
  const originalCreateSnake=p.createSnakeVisual;
  p.createSnakeVisual=function(snake:SnakeSnapshot){
    const v=originalCreateSnake.call(this,snake);
    if(POLISHED_VARIANTS.has(String((snake as any).variant??"NORMAL")))v.sprite.clearTint();
    return v;
  };

  const originalCreate=p.create;
  p.create=function(){
    originalCreate.call(this);
    if(this.__optimizedVisualSceneCreated)return;
    this.__optimizedVisualSceneCreated=true;

    // One static headlight object. Beam is intentionally short/low-alpha.
    const headlights=this.add.graphics();
    headlights.fillStyle(0xffefb0,.07);headlights.fillTriangle(39,-23,108,-39,108,-8);headlights.fillTriangle(39,23,108,8,108,39);
    headlights.fillStyle(0xffe48a,.26);headlights.fillCircle(43,-18,6.5);headlights.fillCircle(43,18,6.5);
    headlights.fillStyle(0xfff5c6,.98);headlights.fillCircle(46,-18,3.3);headlights.fillCircle(46,18,3.3);
    this.tank.addAt(headlights,3);

    // TWO persistent overlays replace a pile of per-upgrade GameObjects.
    this.__vpHullOverlay=this.add.graphics();
    this.__vpTurretOverlay=this.add.graphics();
    this.tank.addAt(this.__vpHullOverlay,3);
    this.turret.add(this.__vpTurretOverlay);
    this.__vpUpgradeKey=-1;

    this.__vpRattleText=this.add.text(800,176,"RATTLER!",{
      fontFamily:"Arial Black, Arial",fontSize:"32px",color:"#ffe49b",stroke:"#2a1609",strokeThickness:7
    }).setOrigin(.5).setScrollFactor(0).setDepth(246).setVisible(false);
    this.__vpRattleFrame=this.add.rectangle(800,450,1560,860).setScrollFactor(0).setDepth(245).setStrokeStyle(4,0xd9b66a,.48).setVisible(false);

    network.addEventListener("rattle_blackout",(event:any)=>{
      const d=event.detail??{},v=this.snakeVisuals.get(d.snakeId);
      if(v){
        this.spawnFx(v.sprite.x,v.sprite.y,{texture:"sb-fx-ring",tint:0xf0ca72,life:380,scale:.55,endScale:3.8,alpha:.9,depth:238});
        this.spawnFloatingText(v.sprite.x,v.sprite.y-34,"RATTLE!",true,0xffe49b);
      }
      const text=this.__vpRattleText,frame=this.__vpRattleFrame;
      this.tweens.killTweensOf(text);this.tweens.killTweensOf(frame);
      text.setVisible(true).setAlpha(.96);frame.setVisible(true).setAlpha(1);
      this.tweens.add({targets:[text,frame],alpha:0,duration:Math.max(320,Number(d.duration??480)),onComplete:()=>{text.setVisible(false);frame.setVisible(false);}});
    });
  };

  // Intentionally DO NOT call GameScene's original incremental evolution method:
  // this single redraw-on-change overlay is cheaper than many permanent objects.
  p.updateTankEvolution=function(snapshot:GameSnapshot){
    for(const u of snapshot.upgrades)this.latestUpgradeLevels.set(u.id,u.level);
    const L=(id:string)=>this.latestUpgradeLevels.get(id)??0;
    const ap=L("AP_AMMO"),auto=L("AUTOLOADER"),engine=L("ENGINE"),armor=L("ARMOR"),hv=L("HV_SHELLS"),scav=L("SCAVENGER"),ord=L("ORDNANCE");
    const key=((((((ap*16+auto)*16+engine)*16+armor)*16+hv)*16+scav)*16+ord);
    if(this.__vpUpgradeKey===key)return;
    this.__vpUpgradeKey=key;

    const g=this.__vpHullOverlay as Phaser.GameObjects.Graphics;
    const t=this.__vpTurretOverlay as Phaser.GameObjects.Graphics;
    if(!g||!t)return;
    g.clear();t.clear();

    // ARMOUR: frontal plate -> side strips -> heavy wedge.
    if(armor>=1){g.fillStyle(0x758273,.68);g.fillRoundedRect(27,-30,16,60,5);g.fillStyle(0xc5cabd,.45);for(const y of [-18,0,18])g.fillCircle(37,y,1.8);}
    if(armor>=3){g.fillStyle(0x59655b,.86);g.fillRoundedRect(-30,-37,58,7,3);g.fillRoundedRect(-30,30,58,7,3);}
    if(armor>=6){g.fillStyle(0x879487,.72);g.fillTriangle(34,-27,54,0,34,27);g.lineStyle(2,0xd4d8cd,.38);g.lineBetween(37,-20,49,0);g.lineBetween(49,0,37,20);}

    // ENGINE: exhausts -> cooling deck -> larger twin stacks.
    if(engine>=1){g.fillStyle(0x222a24,1);g.fillRect(-49,-25,12,8);g.fillRect(-49,17,12,8);g.fillStyle(0x8c9585,.5);g.fillCircle(-49,-21,3);g.fillCircle(-49,21,3);}
    if(engine>=4){g.lineStyle(2.5,0xa3ad99,.4);for(let x=-31;x<=5;x+=9)g.lineBetween(x,-16,x,16);}
    if(engine>=7){g.fillStyle(0x303a32,1);g.fillRoundedRect(-54,-30,18,9,3);g.fillRoundedRect(-54,21,18,9,3);}

    // AP ammunition: ammo box -> exposed rounds -> gold side markings.
    if(ap>=2){g.fillStyle(0x6c5835,.9);g.fillRoundedRect(-18,29,27,10,3);g.lineStyle(1.5,0xd6b96d,.42);g.strokeRoundedRect(-18,29,27,10,3);}
    if(ap>=5){for(const x of [-18,-8,2]){g.fillStyle(0xb78a45,.88);g.fillRoundedRect(x,-39,6,15,2);g.fillStyle(0x31271b,1);g.fillTriangle(x+1,-39,x+5,-39,x+3,-43);}}
    if(ap>=8){g.lineStyle(2.5,0xd1af61,.65);g.lineBetween(-25,-26,18,-26);g.lineBetween(-25,26,18,26);}

    // AUTOLOADER: increasingly visible rear feed/bustle hardware.
    if(auto>=2){g.fillStyle(0x4e5a4d,.88);g.fillRoundedRect(-31,-17,17,34,4);g.lineStyle(1.5,0x9da693,.32);g.strokeRoundedRect(-31,-17,17,34,4);}
    if(auto>=5){g.lineStyle(2,0xbec4b2,.34);for(const y of [-10,0,10])g.lineBetween(-29,y,-17,y);}
    if(auto>=8){g.fillStyle(0x948457,.72);g.fillCircle(-23,-11,3.5);g.fillCircle(-23,0,3.5);g.fillCircle(-23,11,3.5);}

    // SCAVENGER: field box -> antenna -> extra equipment rack.
    if(scav>=1){g.fillStyle(0x8d713c,.9);g.fillRoundedRect(-17,-36,24,9,3);g.lineStyle(1.5,0xe0bd69,.36);g.strokeRoundedRect(-17,-36,24,9,3);}
    if(scav>=4){g.lineStyle(2,0xb5bca9,.72);g.lineBetween(-34,-29,-40,-55);g.fillStyle(0xf0d272,.78);g.fillCircle(-40,-55,2.7);}
    if(scav>=7){g.fillStyle(0x9d7b3e,.82);g.fillRoundedRect(-5,31,32,8,3);}

    // Turret-mounted ballistics/ordnance hardware.
    if(hv>=2){t.fillStyle(0x9aa492,.67);t.fillRect(34,-7,7,14);t.fillStyle(0x303932,1);t.fillRect(36,-9,3,18);}
    if(hv>=5){t.lineStyle(2,0xc5ceba,.48);t.strokeCircle(53,0,8);t.lineBetween(53,-8,53,8);}
    if(ord>=2){t.fillStyle(0x475248,.92);t.fillRoundedRect(58,-8,19,16,3);t.lineStyle(2,0x9da596,.32);t.strokeRoundedRect(58,-8,19,16,3);}
    if(ord>=5){t.fillStyle(0x171d19,1);t.fillRect(70,-10,13,20);t.fillStyle(0xc48b43,.52);t.fillRect(79,-7,6,14);}
  };
}
