# 音素材クレジット台帳(CC0)

このゲームで使う外部音素材は全て **CC0(Creative Commons Zero)** のものだけ。
台帳に無い素材は使わない。素材はそのまま鳴らさず、トリミング・フェード・
ピーク正規化・再エンコードの加工をしてから `assets/audio/` に置いている。
ゲーム内での音量・ピッチ・重ね方は `src/audio/params.ts` と `engine.ts` が決める。

入手元は Kenney(https://kenney.nl)の音声パックが中心で、各パック同梱の
License.txt に CC0 の明記があることを取得時に確認した(取得日: 2026-11-08)。
第 3 ラウンド(2026-11-09)で武器音に実録素材を追加した: The Free Firearm
Sound Library(OpenGameArt、作者ページとライブラリ冒頭で CC0 を確認)と、
rubberduck の花火/大砲録音(CC0)。環境ループも同ラウンドで rubberduck の
"100 CC0 SFX #2"(実録ループ集、CC0)に差し替えた。詳細は各行に書く。
ライセンス全文: http://creativecommons.org/publicdomain/zero/1.0/

| ゲーム内ファイル | 元のファイル名 | パック / 入手元 | ライセンス | 加工内容 |
|---|---|---|---|---|
| pulse_0.ogg | Carl Gustav M45 G_31P.wav(近距離・単発、0.29 秒〜) | The Free Firearm Sound Library(Ben Jaszczak 他)/ https://opengameart.org/content/the-free-firearm-sound-library | CC0 | パルス発射の芯(実録)。0.12 秒に切り、ローパス 7.5 kHz + compand で機構部を持ち上げ、ブラスト RMS を 3 テイクで統一。-1 dB でクリップ、ogg 再エンコード |
| pulse_1.ogg | Carl Gustav M45 G_33P.wav(近距離・バースト 1 発目) | The Free Firearm Sound Library / 同上 | CC0 | パルスのバリエーション(同じ銃の別テイク)。加工は pulse_0 と同じ |
| pulse_2.ogg | Carl Gustav M45 G_33P.wav(近距離・バースト 3 発目) | The Free Firearm Sound Library / 同上 | CC0 | パルスのバリエーション。加工は pulse_0 と同じ |
| turret_0.ogg | Carl Gustav M45 G_20P.wav(中距離・単発、0.34 秒〜) | The Free Firearm Sound Library / 同上 | CC0 | 砲台発射の芯(パルスと同じ銃の中距離テイク)。0.24 秒に切り、ローパス 6 kHz + compand、パルスよりブラストを約 1.4 dB 低く |
| cannon_body.ogg | Benelli Nova O_21P.wav(12 ゲージ・近距離、0.42 秒〜) | The Free Firearm Sound Library / 同上 | CC0 | 重粒子砲の胴体。0.55 秒に切り、ローパス 2.8 kHz で暗くし、compand で尾を持ち上げ |
| cannon_bang.ogg | cannon_01.ogg(花火の大砲) | rubberduck "25 CC0 bang / firework SFX" / https://opengameart.org/content/25-cc0-bang-firework-sfx | CC0 | 重粒子砲の残響尾。ローパス 1.8 kHz + compand、全体 RMS -16 dB に調整 |
| hit_0.ogg | impactMetal_medium_002.ogg | Kenney "impact-sounds" / https://kenney.nl/assets/impact-sounds | CC0 | 敵への命中の主体(金属打撃)。ピーク -3 dB に正規化、ogg 再エンコード |
| hit_1.ogg | impactMetal_light_002.ogg | Kenney "impact-sounds" / https://kenney.nl/assets/impact-sounds | CC0 | 命中のバリエーション。ピーク -3 dB に正規化、ogg 再エンコード |
| down_impact.ogg | impactPunch_heavy_001.ogg | Kenney "impact-sounds" / https://kenney.nl/assets/impact-sounds | CC0 | 敵撃破の打撃層。ピーク -2 dB に正規化、ogg 再エンコード |
| hurt_impact.ogg | impactPunch_heavy_003.ogg | Kenney "impact-sounds" / https://kenney.nl/assets/impact-sounds | CC0 | 被弾の肉感層。ピーク -3 dB に正規化、ogg 再エンコード |
| land_0.ogg | impactSoft_heavy_000.ogg | Kenney "impact-sounds" / https://kenney.nl/assets/impact-sounds | CC0 | 着地の主体。ピーク -3 dB に正規化、ogg 再エンコード |
| footstep_0.ogg | footstep_concrete_000.ogg | Kenney "impact-sounds" / https://kenney.nl/assets/impact-sounds | CC0 | 足音(コンクリート)のバリエーション。ピーク -6 dB に正規化、ogg 再エンコード |
| footstep_1.ogg | footstep_concrete_001.ogg | Kenney "impact-sounds" / https://kenney.nl/assets/impact-sounds | CC0 | 足音のバリエーション。ピーク -6 dB に正規化、ogg 再エンコード |
| footstep_2.ogg | footstep_concrete_002.ogg | Kenney "impact-sounds" / https://kenney.nl/assets/impact-sounds | CC0 | 足音のバリエーション。ピーク -6 dB に正規化、ogg 再エンコード |
| footstep_3.ogg | footstep_concrete_003.ogg | Kenney "impact-sounds" / https://kenney.nl/assets/impact-sounds | CC0 | 足音のバリエーション。ピーク -6 dB に正規化、ogg 再エンコード |
| footstep_4.ogg | footstep_concrete_004.ogg | Kenney "impact-sounds" / https://kenney.nl/assets/impact-sounds | CC0 | 足音のバリエーション。ピーク -6 dB に正規化、ogg 再エンコード |
| ladder_0.ogg | metalClick.ogg | Kenney "rpg-audio" / https://kenney.nl/assets/rpg-audio | CC0 | 梯子の段音(金属クリック)。ピーク -6 dB に正規化、ogg 再エンコード |
| ladder_1.ogg | tick_004.ogg | Kenney "interface-sounds" / https://kenney.nl/assets/interface-sounds | CC0 | 梯子の段音の交互バリエーション。ピーク -6 dB に正規化、ogg 再エンコード |
| switch.ogg | metalLatch.ogg | Kenney "rpg-audio" / https://kenney.nl/assets/rpg-audio | CC0 | 武器切替(掛け金)の主体。ピーク -4 dB に正規化、ogg 再エンコード |
| tick.ogg | tick_002.ogg | Kenney "interface-sounds" / https://kenney.nl/assets/interface-sounds | CC0 | 砲の弾回復の合図。ピーク -6 dB に正規化、ogg 再エンコード |
| confirm.ogg | confirmation_001.ogg | Kenney "interface-sounds" / https://kenney.nl/assets/interface-sounds | CC0 | 復活点更新の合図。ピーク -4 dB に正規化、ogg 再エンコード |
| pickup_charge.ogg | powerUp5.ogg | Kenney "digital-audio" / https://kenney.nl/assets/digital-audio | CC0 | 取得音(砲弾セル)。ピーク -4 dB に正規化、ogg 再エンコード |
| pickup_heal.ogg | powerUp2.ogg | Kenney "digital-audio" / https://kenney.nl/assets/digital-audio | CC0 | 取得音(回復セル)。ピーク -4 dB に正規化、ogg 再エンコード |
| pickup_ration.ogg | powerUp10.ogg | Kenney "digital-audio" / https://kenney.nl/assets/digital-audio | CC0 | 取得音(糧食セル)。ピーク -4 dB に正規化、ogg 再エンコード |
| cache.ogg | open_002.ogg | Kenney "interface-sounds" / https://kenney.nl/assets/interface-sounds | CC0 | 補給キャッシュ開封の主体。ピーク -4 dB に正規化、ogg 再エンコード |
| eat_0.ogg | cloth3.ogg | Kenney "rpg-audio" / https://kenney.nl/assets/rpg-audio | CC0 | 自動摂取の衣擦れ層 1。ピーク -5 dB に正規化、ogg 再エンコード |
| eat_1.ogg | cloth4.ogg | Kenney "rpg-audio" / https://kenney.nl/assets/rpg-audio | CC0 | 自動摂取の衣擦れ層 2。ピーク -5 dB に正規化、ogg 再エンコード |
| warn_error.ogg | error_003.ogg | Kenney "interface-sounds" / https://kenney.nl/assets/interface-sounds | CC0 | 満腹度警告の基音。ピーク -4 dB に正規化、ogg 再エンコード |
| jingle_milestone.ogg | jingles_STEEL09.ogg | Kenney "music-jingles" / https://kenney.nl/assets/music-jingles | CC0 | 階層の節目ジングル(金属楽器)。ピーク -3 dB に正規化、ogg 再エンコード |
| jingle_record.ogg | jingles_STEEL04.ogg | Kenney "music-jingles" / https://kenney.nl/assets/music-jingles | CC0 | 最深の新記録ジングル。ピーク -3 dB に正規化、ogg 再エンコード |
| rest.ogg | jingles_PIZZI01.ogg | Kenney "music-jingles" / https://kenney.nl/assets/music-jingles | CC0 | 休憩点の初回補給(ピチカート)。ピーク -4 dB に正規化、ogg 再エンコード |
| crash_metal.ogg | impactMetal_002.ogg | Kenney "sci-fi-sounds" / https://kenney.nl/assets/sci-fi-sounds | CC0 | ボス激突の主体(金属衝突)。ピーク -2 dB に正規化、ogg 再エンコード |
| explosion_crunch.ogg | explosionCrunch_003.ogg | Kenney "sci-fi-sounds" / https://kenney.nl/assets/sci-fi-sounds | CC0 | ボス撃破・大破砕の崩壊層。ピーク -2 dB に正規化、ogg 再エンコード |
| explosion_low.ogg | lowFrequency_explosion_000.ogg | Kenney "sci-fi-sounds" / https://kenney.nl/assets/sci-fi-sounds | CC0 | ボス出現・砲発射の低音層。ピーク -2 dB に正規化、ogg 再エンコード |
| mining_0.ogg | impactMining_001.ogg | Kenney "impact-sounds" / https://kenney.nl/assets/impact-sounds | CC0 | 砲の破砕の主体(採掘打撃)。ピーク -3 dB に正規化、ogg 再エンコード |
| mining_1.ogg | impactMining_003.ogg | Kenney "impact-sounds" / https://kenney.nl/assets/impact-sounds | CC0 | 破砕のバリエーション。ピーク -3 dB に正規化、ogg 再エンコード |
| thruster.ogg | thrusterFire_000.ogg | Kenney "sci-fi-sounds" / https://kenney.nl/assets/sci-fi-sounds | CC0 | ボス突進の噴射層(0.2 秒から 0.40 秒を抜粋、両端フェード)。ピーク -4 dB に正規化、ogg 再エンコード |
| amb_machine.ogg | sfx100v2_loop_machine_01.ogg | rubberduck "100 CC0 SFX #2" / https://opengameart.org/content/100-cc0-sfx-2 | CC0 | 環境ループ(機械系: 寒鋼基層・電力区・廃棄沈殿層)。5.8 秒に切り、末尾 1.6 秒を頭へ等パワーで折り返して継ぎ目を消し、ローパス 11 kHz、RMS -26 dB |
| amb_foundry.ogg | sfx100v2_loop_machine_02.ogg | rubberduck "100 CC0 SFX #2" / 同上 | CC0 | 環境ループ(精錬区)。7 秒+折り返し 2 秒、加工は amb_machine と同じ |
| amb_room.ogg | sfx100v2_loop_ambient_01.ogg | rubberduck "100 CC0 SFX #2" / 同上 | CC0 | 環境ループ(居住区画)。7 秒+折り返し 2 秒、加工は amb_machine と同じ |
| amb_water.ogg | sfx100v2_loop_water_01.ogg | rubberduck "100 CC0 SFX #2" / 同上 | CC0 | 環境ループ(大空洞水域)。4.8 秒+折り返し 1.4 秒、加工は amb_machine と同じ |
| amb_bio.ogg | sfx100v2_loop_ambient_04.ogg | rubberduck "100 CC0 SFX #2" / 同上 | CC0 | 環境ループ(生体異物区)。7 秒+折り返し 2 秒、加工は amb_machine と同じ。生体専用の実録が CC0 で無く、空気のうねりのあるアンビエント録音で代替 |

総容量: 757 KB(全 42 ファイル)
