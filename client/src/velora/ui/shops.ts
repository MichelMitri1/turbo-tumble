import type { PersonModel } from '../assets';
import { CARS, PAINTS } from '../actors/vehicle';
import { WEAPONS, WEAPON } from '../combat';
import type { Game } from '../game';
import type { Shop } from '../world/city';
import { SHOP_STYLE } from '../render/cityview';

/**
 * Shop menus: Lock & Load (guns, ammo, body armour), Threadz (outfits), Quik-Stop (snacks
 * — or rob it at gunpoint), Spray Away (respray: new paint, repairs, and the cops lose
 * your car), Velora General (patch up), Velora Motors (buy a car).
 */

interface Item {
  label: string;
  price: number;
  note?: string;
  disabled?: boolean;
  buy: () => string | void;
}

const OUTFITS: Array<{ model: PersonModel; name: string; price: number }> = [
  { model: 'casual', name: 'Street Casual', price: 120 },
  { model: 'hoodie', name: 'Hoodie & Joggers', price: 160 },
  { model: 'suit', name: 'Three-Piece Suit', price: 900 },
  { model: 'business', name: 'Business Casual', price: 450 },
  { model: 'worker', name: 'Workwear', price: 140 },
  { model: 'punk', name: 'Punk Jacket', price: 260 },
  { model: 'farmer', name: 'Country Plaid', price: 110 },
  { model: 'adventurer', name: 'Outdoors Gear', price: 320 },
  { model: 'woman', name: 'Summer Look', price: 220 },
  { model: 'woman2', name: 'City Look', price: 280 },
];
const DEALER = ['compact', 'hatch', 'sedan', 'wagon', 'pickup', 'suv', 'muscle', 'sports', 'super', 'racer', 'van', 'boxtruck', 'tractor'];

export class ShopUI {
  el: HTMLDivElement | null = null;
  private sel = 0;
  private items: Item[] = [];
  private shop: Shop | null = null;
  private msg = '';

  constructor(private g: Game) {}

  get open(): boolean {
    return !!this.el;
  }

  show(shop: Shop): void {
    this.shop = shop;
    this.sel = 0;
    this.msg = '';
    this.el = document.createElement('div');
    this.el.className = 'v-shop';
    document.body.appendChild(this.el);
    this.render();
  }

  close(): void {
    this.el?.remove();
    this.el = null;
    this.shop = null;
  }

  private build(): Item[] {
    const g = this.g;
    const p = g.player;
    const s = this.shop!;
    const pay = (price: number, fn: () => void) => () => {
      if (p.cash < price) {
        g.audio.blip('error');
        return 'Not enough cash.';
      }
      p.cash -= price;
      fn();
      g.audio.blip('buy');
      g.save();
    };
    switch (s.kind) {
      case 'guns':
        return [
          ...WEAPONS.filter((w) => w.price > 0).flatMap((w) => {
            const owned = p.inv.owned.has(w.id);
            return owned
              ? [{ label: `${w.name} ammo ×${w.ammoPack}`, price: w.ammoPrice, buy: pay(w.ammoPrice, () => p.inv.give(w.id, w.ammoPack)) }]
              : [{ label: w.name, price: w.price, note: `${w.dmg * (w.pellets ?? 1)} dmg · ${w.mag}-round mag`, buy: pay(w.price, () => p.inv.give(w.id, w.mag * 3)) }];
          }),
          { label: 'Body Armor', price: 500, note: 'Full armour', disabled: p.armor >= 100, buy: pay(500, () => (p.armor = 100)) },
        ];
      case 'clothes':
        return OUTFITS.map((o) => ({ label: o.name, price: o.price, disabled: p.model === o.model, note: p.model === o.model ? 'Wearing' : '', buy: pay(o.price, () => p.setModel(o.model)) }));
      case 'food':
        return [
          { label: 'Ego Chaser bar', price: 5, note: '+20 health', buy: pay(5, () => (p.health = Math.min(200, p.health + 20))) },
          { label: 'Meteorite bar', price: 10, note: '+50 health', buy: pay(10, () => (p.health = Math.min(200, p.health + 50))) },
          { label: 'E-Cola six pack', price: 25, note: 'Full health', buy: pay(25, () => (p.health = 200)) },
          {
            label: '🔫 Rob the store',
            price: 0,
            note: p.armed ? 'Grab the register — the cops get called' : 'You need a weapon',
            disabled: !p.armed || g.robbedRecently(s),
            buy: () => {
              const take = 300 + Math.floor(Math.random() * 900);
              p.cash += take;
              g.robbed(s);
              g.audio.blip('cash');
              g.crime('robbery', s.x, s.z, true);
              this.close();
              g.hud.flash(`+$${take}`, 'good');
            },
          },
        ];
      case 'respray': {
        const car = p.car;
        return [
          {
            label: 'Respray & repair',
            price: 500,
            note: car ? 'New paint, fixed up — the cops lose track of you' : 'Drive a car in here',
            disabled: !car,
            buy: pay(500, () => {
              car!.repaint(PAINTS[Math.floor(Math.random() * PAINTS.length)]!);
              car!.health = 1000;
              if (!g.police.units.some((u) => u.car.pos.distanceTo(car!.pos) < 40)) g.police.clear();
            }),
          },
        ];
      }
      case 'hospital':
        return [{ label: 'Get patched up', price: 200, disabled: p.health >= 200, buy: pay(200, () => (p.health = 200)) }];
      case 'cars':
        return DEALER.map((m) => {
          const d = CARS[m]!;
          return { label: d.name, price: d.price, note: `${Math.round(d.top * 3.6)} km/h top speed`, buy: pay(d.price, () => g.deliverCar(m, s)) };
        });
      case 'police':
        return [{ label: 'Pay off your wanted level', price: 2000 * Math.max(1, g.police.level), disabled: g.police.level === 0 || g.police.level > 2, note: 'Up to two stars', buy: pay(2000 * Math.max(1, g.police.level), () => g.police.clear()) }];
    }
  }

  private render(): void {
    if (!this.el || !this.shop) return;
    const s = this.shop;
    this.items = this.build();
    const st = SHOP_STYLE[s.kind];
    this.el.innerHTML = `<div class="v-shopbox" style="--c:${st.color}">
      <header><b>${st.icon} ${s.name}</b><span>$${this.g.player.cash.toLocaleString()}</span></header>
      <ul>${this.items.map((it, i) => `<li class="${i === this.sel ? 'sel' : ''} ${it.disabled ? 'off' : ''}" data-i="${i}"><span>${it.label}<small>${it.note ?? ''}</small></span><b>${it.price ? '$' + it.price.toLocaleString() : ''}</b></li>`).join('')}</ul>
      <footer>${this.msg || '↑↓ choose · Enter / click buy · Esc leave'}</footer></div>`;
    this.el.querySelectorAll<HTMLElement>('li').forEach((li) => {
      li.onclick = () => {
        this.sel = Number(li.dataset.i);
        this.buy();
      };
    });
  }

  private buy(): void {
    const it = this.items[this.sel];
    if (!it || it.disabled) return;
    const err = it.buy();
    this.msg = err ?? '';
    if (this.el) this.render();
  }

  key(code: string): void {
    if (!this.el) return;
    if (code === 'ArrowDown' || code === 'KeyS') this.sel = (this.sel + 1) % this.items.length;
    else if (code === 'ArrowUp' || code === 'KeyW') this.sel = (this.sel - 1 + this.items.length) % this.items.length;
    else if (code === 'Enter' || code === 'Space') return this.buy();
    else if (code === 'Escape' || code === 'Backspace') return this.close();
    else return;
    this.g.audio.blip('click');
    this.render();
  }
}

export { WEAPON };
