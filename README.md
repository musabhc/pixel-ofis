# Piksel Ofis

Claude Code için piksel-art bir ofis paneli. Sohbet yanında açılır; Claude'un ana oturumu
**Şef**, alt ajanları rol adlarıyla (Kaşif, Mimar, Usta…) çalışanlar olarak görünür ve
kullandıkları araca göre ofisteki istasyonlara yürür: kitaplık (okuma/arama), masa
(düzenleme), sunucu (terminal), küre (web), tahta (planlama), kafe (boşta).

![Piksel Ofis](docs/ofis.png)

## Neler var

- **Aynı anda çalışan sohbetler:** makinedeki bütün Claude sohbetleri aynı ofiste, `#1`,
  `#2` gibi kalıcı numaralarıyla görünür.
- **Pano:** her sohbetin adı (panelden verilir), amacı, son görevleri ve değiştirdiği
  dosyalar. Kapanan sohbetler 24 saat panoda kalır.
- **Sohbetler birbirinden haberdar:** başka bir sohbet çalışırken Claude, bir dosyayı
  değiştirdiği anda panonun kısa bir özetini okur. Yalnızca okuma ya da konuşma yapılan turlara
  bu özet eklenmez. Pano değişmediyse özet tekrarlanmaz, nasıl mesaj atılacağı da sohbet başına
  bir kez söylenir. Başka bir sohbetin yakın zamanda değiştirdiği dosyanın üzerine körlemesine
  yazılmaz. `ofis_mesaj` aracıyla sohbetler birbirine numarasıyla mesaj atabilir.
- **Görev kutusu:** panelden ekibe görev verilir; dosya yolu ya da son ekran görüntüsü ek
  olarak eklenebilir.
- **Göstergeler:** 5 saatlik ve 7 günlük kullanım limiti, bağlam doluluğu, prompt önbelleği,
  maliyet.

## Token tasarrufu

Panelin **Token** bölümü ve birkaç küçük yardımcı, harcamayı görünür kılıp gereksiz olanı
keser:

- **Ne nereye gidiyor:** son turun girdi, önbellekten okunan, önbelleğe yazılan ve çıktı
  tokenleri; önbellek isabet oranı. Bağlama en çok yer kaplayan araç çıktıları ve araç türüne
  göre toplamlar. Her istekte giden sabit yük: sistem istemi, araç tanımları, bellek
  dosyaları ve en büyük bellek dosyaları.
- **Önbellek sıcaklığı:** son yanıttan bu yana geçen süre. Kafedeki kahve önbellek
  sıcakken tüter, soğuyunca söner. Uzun bir aradan sonra gelen ilk mesaj pahalı olacaksa bunu
  önceden görürsünüz. Önbelleğin 5 dakikalık mı 1 saatlik mi olduğunu ofis ilk uzun aradan
  sonra kendisi öğrenir.
- **Pano özetiyle sıkıştırma:** bağlam %60'ı geçince panelde "Pano özetiyle sıkıştır" düğmesi
  çıkar, %70'te bir kez hatırlatılır. Sıkıştırma ister düğmeden, ister `/compact`'tan, ister
  otomatik yapılsın, özetleyiciye sohbetin amacı, son görevleri ve değiştirdiği dosyalar
  söylenir. Böylece özet önemli olanı kaybetmez.
- **Üzerine yazmada fark:** başka bir sohbetin değiştirdiği dosyaya `Write` durdurulduğunda
  Claude'a dosyanın commit edilmemiş değişiklikleri kısa bir `git diff` olarak gösterilir. Ayrıca
  dosyanın tamamını yeniden üretmek yerine `Edit` ile yalnızca kendi değişikliğini yapması
  istenir.
- **Keşif paylaşımı:** bir alt ajanın (Kaşif, Usta…) raporu iki saat boyunca diğer sohbetlerle
  paylaşılır. Başka bir sohbet aynı projede aynı soruyu araştırtmak üzereyse alt ajan
  başlamadan önce bu rapor ona bir kez önerilir. Rapor yetmezse aynı çağrı tekrarlanır ve alt
  ajan başlar. Paylaşılan keşifler panelde listelenir.
- **Araç erteleme:** panelde öndeki araçların açıklama boyutları görünür. Seyrek kullandığınız
  araçların adlarını yazarsanız bu araçlar yeni sohbetlerde ToolSearch arkasında bekler, şemaları
  yalnız gerektiğinde yüklenir. Açık sohbetler değişmez: onların araç listesini değiştirmek
  prompt önbelleğini baştan yazdırırdı. `ToolSearch` ertelenemez.

Her şey yereldir: veriler yalnız `~/.claude/pixel-ofis-live/` altında (panolar, günlükler,
keşifler) ve eklentinin kendi deposunda tutulur, hiçbir yere gönderilmez.

## Kurulum

Güncel bir Claude Code gerekir (VS Code eklentisi ya da terminal). Mod sistemi Claude
Code'da erken erişimdedir; eklentiyi güncel tutun.

**Windows, çift tıklayarak:** [`kur.cmd`](kur.cmd) dosyasını indirip çalıştırın.

**Claude Code terminalinde:**

```
/plugin install pixel-ofis --marketplace musabhc/pixel-ofis
```

**Komut satırından:**

```
claude plugin install pixel-ofis --marketplace musabhc/pixel-ofis
```

Kurulumdan sonra yeni bir sohbet açın; panel kendiliğinden açılır. Kapatırsanız `/ofis`
yazarak yeniden açabilirsiniz.

## Geliştirme

```
claude plugin validate .
claude plugin test .
```

## Lisans

MIT
