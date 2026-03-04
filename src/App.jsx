import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, 
  FileSpreadsheet, 
  Settings, 
  Printer, 
  ImageIcon, 
  Trash2, 
  CheckCircle, 
  Users, 
  Layout, 
  FileText,
  AlertCircle,
  Download,
  Loader2
} from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { createWorker } from 'tesseract.js';

// LocalStorage anahtarları
const STORAGE_KEYS = {
  IMAGES: 'rekPDF_images',
  STUDENTS: 'rekPDF_students'
};

// LocalStorage yardımcı fonksiyonları
const getFromStorage = (key, defaultValue = []) => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.error(`LocalStorage okuma hatası (${key}):`, error);
    return defaultValue;
  }
};

const saveToStorage = (key, data) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error(`LocalStorage yazma hatası (${key}):`, error);
    throw new Error('Veri kaydedilemedi. LocalStorage dolu olabilir.');
  }
};

export default function App() {
  const [activeTab, setActiveTab] = useState('upload');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  
  // State: Images & Students (LocalStorage'dan beslenecek)
  const [images, setImages] = useState([]);
  const [students, setStudents] = useState([]);
  
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [quotas, setQuotas] = useState({});
  const [design, setDesign] = useState({
    columns: 2,
    headerText: 'Kişiye Özel Çalışma Fasikülü',
    showStudentName: true
  });
  const [previewQuestions, setPreviewQuestions] = useState([]);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const pdfRef = useRef(null);

  // --- 1. LOCALSTORAGE'DAN VERİ ÇEKME İŞLEMLERİ ---
  useEffect(() => {
    // İlk yüklemede verileri LocalStorage'dan al
    const loadedImages = getFromStorage(STORAGE_KEYS.IMAGES);
    const loadedStudents = getFromStorage(STORAGE_KEYS.STUDENTS);
    
    // Yüklenme sırasına göre sırala
    loadedImages.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    
    setImages(loadedImages);
    setStudents(loadedStudents);
  }, []);

  // Images değiştiğinde LocalStorage'a kaydet
  useEffect(() => {
    if (images.length > 0 || localStorage.getItem(STORAGE_KEYS.IMAGES)) {
      saveToStorage(STORAGE_KEYS.IMAGES, images);
    }
  }, [images]);

  // Students değiştiğinde LocalStorage'a kaydet
  useEffect(() => {
    if (students.length > 0 || localStorage.getItem(STORAGE_KEYS.STUDENTS)) {
      saveToStorage(STORAGE_KEYS.STUDENTS, students);
    }
  }, [students]);

  // --- 2. GÖRSEL YÜKLEME VE SIKIŞTIRMA İŞLEMLERİ ---
  const readFileAsDataURL = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const compressImage = (dataUrl, maxWidth = 700) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = dataUrl;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        // Veritabanı sınırlarına (1MB) uyması için kaliteyi %60'a çevir
        resolve(canvas.toDataURL('image/jpeg', 0.6)); 
      };
    });
  };

  // OCR ile resimden metin çıkarma
  const extractTextFromImage = async (imageSrc) => {
    try {
      const worker = await createWorker('tur+eng'); // Türkçe ve İngilizce dil desteği
      
      // OCR ayarlarını optimize et - daha yüksek doğruluk için
      // pageseg_mode: 6 = Tek düzgün metin bloğu (sorular için ideal)
      await worker.setParameters({
        tessedit_pageseg_mode: '6', // Tek düzgün metin bloğu varsayımı
      });
      
      // OCR işlemini yap - tüm resmi işle
      const { data: { text } } = await worker.recognize(imageSrc);
      
      await worker.terminate();
      
      // Metni temizle ama formatı koru
      let cleanedText = text;
      
      // Sadece gereksiz boşlukları temizle, satır sonlarını ve formatı koru
      // Birden fazla yan yana boşluğu tek boşluğa çevir (ama satır sonlarını koru)
      cleanedText = cleanedText.replace(/[ \t]+/g, ' '); 
      // 3+ ardışık satır sonunu 2'ye çevir
      cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n');
      
      // Baştan ve sondan gereksiz boşlukları temizle
      cleanedText = cleanedText.trim();
      
      return cleanedText;
    } catch (error) {
      console.error('OCR hatası:', error);
      return '';
    }
  };

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    setIsUploading(true);
    setUploadError('');
    
    const newImages = [];
    
    for (const file of files) {
      try {
        const dataUrl = await readFileAsDataURL(file);
        const compressedSrc = await compressImage(dataUrl);

        // LocalStorage boyut sınırı kontrolü (yaklaşık 5MB per item limit)
        if (compressedSrc.length > 1048400) {
          throw new Error(`"${file.name}" boyutu çok büyük. Lütfen daha düşük çözünürlüklü bir görsel seçin.`);
        }

        const nameWithoutExt = file.name.split('.').slice(0, -1).join('.');
        const topicGuess = nameWithoutExt.split(/[-_]/)[0].trim();
        const newId = Math.random().toString(36).substr(2, 9);

        // OCR ile metin çıkar
        const extractedText = await extractTextFromImage(dataUrl);

        newImages.push({
          id: newId,
          filename: file.name,
          topic: topicGuess,
          src: compressedSrc,
          text: extractedText, // OCR'dan çıkarılan metin
          createdAt: Date.now()
        });
      } catch (error) {
        console.error("Resim yükleme/sıkıştırma hatası:", error);
        setUploadError(error.message);
      }
    }
    
    // Tüm yeni resimleri state'e ekle
    if (newImages.length > 0) {
      setImages(prev => [...newImages, ...prev]);
    }
    
    setIsUploading(false);
    // Aynı dosyaları tekrar yükleyebilmek için input'u temizle
    e.target.value = '';
  };

  const updateImageTopic = (id, newTopic) => {
    setImages(prev => 
      prev.map(img => 
        img.id === id ? { ...img, topic: newTopic } : img
      )
    );
  };

  const removeImage = (id) => {
    setImages(prev => prev.filter(img => img.id !== id));
  };

  // --- 3. ÖĞRENCİ VERİSİ İŞLEMLERİ ---
  const handleExcelPaste = async (e) => {
    const text = e.target.value;
    if (!text) return;

    const rows = text.split('\n');
    const newStudents = [];

    rows.forEach((rowStr, index) => {
      if (!rowStr.trim()) return;
      if (index === 0 && rowStr.toLowerCase().includes('ad') && rowStr.toLowerCase().includes('konu')) return; 
      
      let parts = rowStr.split(/\t|,|;|-/);
      
      if (parts.length === 1 && rowStr.includes(' ')) {
        const words = rowStr.trim().split(/\s+/);
        if (words.length >= 2) {
          const topic = words.pop(); 
          parts = [words.join(' '), topic]; 
        }
      }

      const name = parts[0]?.trim();
      if (!name) return;

      let topics = [];
      if (parts.length > 1) {
        topics = parts.slice(1).join(',').split(',').map(t => t.trim()).filter(Boolean);
      }
      
      const newId = Math.random().toString(36).substr(2, 9);
      newStudents.push({ 
        id: newId, 
        name, 
        topics, 
        createdAt: Date.now() 
      });
    });

    if (newStudents.length > 0) {
      setStudents(prev => [...prev, ...newStudents]);
    }
    
    e.target.value = ''; 
  };

  const removeStudent = (id) => {
    setStudents(prev => prev.filter(s => s.id !== id));
    if (selectedStudentId === id) setSelectedStudentId('');
  };

  // --- 4. DİZGİ VE KOTA İŞLEMLERİ ---
  const handleQuotaChange = (topic, value) => {
    setQuotas(prev => ({
      ...prev,
      [topic.toLowerCase()]: parseInt(value) || 0
    }));
  };

  useEffect(() => {
    if (!selectedStudentId) {
      setPreviewQuestions([]);
      return;
    }

    const student = students.find(s => s.id === selectedStudentId);
    if (!student) return;

    let finalQs = [];
    student.topics.forEach(topic => {
      const topicLower = topic.toLowerCase();
      const requestedCount = quotas[topicLower] || 0;
      
      const availableImages = images.filter(img => img.topic.toLowerCase() === topicLower);
      const selected = availableImages.slice(0, requestedCount);
      
      finalQs = [...finalQs, ...selected];
    });

    setPreviewQuestions(finalQs);
  }, [selectedStudentId, quotas, images, students]);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = async () => {
    if (!selectedStudentId || previewQuestions.length === 0) return;
    
    setIsGeneratingPDF(true);
    
    try {
      const element = pdfRef.current;
      if (!element) {
        throw new Error('PDF içeriği bulunamadı');
      }

      // Metinlerin render edilmesi için kısa bir bekleme
      await new Promise(resolve => setTimeout(resolve, 500));

      // Element genişliğini tam kullan - 210mm = 794px (96 DPI'da)
      // Gerçek genişliği al, eğer daha küçükse 794px'e zorla
      const computedStyle = window.getComputedStyle(element);
      const elementWidth = Math.max(
        element.offsetWidth || 794,
        element.scrollWidth || 794,
        parseInt(computedStyle.width) || 794,
        794 // Minimum 210mm
      );
      const elementHeight = element.scrollHeight || element.offsetHeight;

      // HTML'i canvas'a dönüştür - metinleri yakalamak için optimize edilmiş ayarlar
      const canvas = await html2canvas(element, {
        scale: 2, // Scale'i 2'ye düşürdük (3 çok büyük oluyordu)
        useCORS: true,
        allowTaint: false,
        logging: false,
        backgroundColor: '#ffffff',
        width: elementWidth,
        height: elementHeight,
        windowWidth: elementWidth,
        windowHeight: elementHeight,
        foreignObjectRendering: false,
        onclone: (clonedDoc) => {
          // Ana container'ı bul ve genişliğini zorla
          const allDivs = clonedDoc.body.querySelectorAll('div');
          const clonedElement = Array.from(allDivs).find(
            el => {
              const className = el.className || '';
              return className.includes('w-[210mm]') || 
                     (el.offsetWidth > 700 && el.offsetWidth < 900);
            }
          );
          
          if (clonedElement) {
            clonedElement.style.width = `${elementWidth}px`;
            clonedElement.style.maxWidth = `${elementWidth}px`;
            clonedElement.style.minWidth = `${elementWidth}px`;
            clonedElement.style.boxSizing = 'border-box';
          }
          
          // İç container'ı da genişliğe zorla
          const innerContainers = clonedDoc.body.querySelectorAll('div');
          innerContainers.forEach(container => {
            const className = container.className || '';
            if (className.includes('p-[2mm]') || className.includes('p-[')) {
              container.style.width = '100%';
              container.style.maxWidth = '100%';
              container.style.boxSizing = 'border-box';
            }
          });
          
          // Sütun container'larını da kontrol et ve genişliklerini zorla
          const columnContainers = clonedDoc.body.querySelectorAll('div[class*="w-1/"]');
          columnContainers.forEach(container => {
            container.style.boxSizing = 'border-box';
            const className = container.className || '';
            if (className.includes('w-1/2')) {
              container.style.width = '50%';
              container.style.flexShrink = '0';
            } else if (className.includes('w-1/3')) {
              container.style.width = '33.333%';
              container.style.flexShrink = '0';
            }
          });
          
          // Ana sütun container'ını da kontrol et
          const mainColumnContainer = Array.from(clonedDoc.body.querySelectorAll('div')).find(
            el => {
              const className = el.className || '';
              return className.includes('flex-1 flex relative');
            }
          );
          if (mainColumnContainer) {
            mainColumnContainer.style.width = '100%';
            mainColumnContainer.style.boxSizing = 'border-box';
          }
          
          // Metin içeren elementleri bul ve görünür yap
          const textElements = clonedDoc.body.querySelectorAll('.pdf-text-content');
          textElements.forEach(el => {
            el.style.display = 'block';
            el.style.visibility = 'visible';
            el.style.opacity = '1';
            el.style.color = '#1f2937';
            el.style.fontFamily = 'monospace, "Courier New", Courier, monospace';
            el.style.whiteSpace = 'pre-wrap';
            el.style.wordBreak = 'break-word';
          });
          
          // Tüm gizli elementleri kontrol et
          const allElements = clonedDoc.body.querySelectorAll('*');
          allElements.forEach(el => {
            const computedStyle = clonedDoc.defaultView?.getComputedStyle(el);
            if (computedStyle) {
              if (computedStyle.display === 'none') {
                el.style.display = 'block';
              }
              if (computedStyle.visibility === 'hidden') {
                el.style.visibility = 'visible';
              }
              if (computedStyle.opacity === '0') {
                el.style.opacity = '1';
              }
            }
          });
        }
      });

      const imgData = canvas.toDataURL('image/png');
      
      // PDF boyutları (A4: 210mm x 297mm)
      const pdfWidth = 210; // mm
      const pdfHeight = 297; // mm
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      
      // Piksel'i mm'ye dönüştür (scale 2 kullanıldığı için)
      // 1mm = (96 DPI * scale) / 25.4mm = (96 * 2) / 25.4 ≈ 7.559 pixels
      const pixelsPerMM = (96 * 2) / 25.4;
      
      // Canvas genişliğini mm'ye çevir
      const imgWidthInMM = imgWidth / pixelsPerMM;
      const imgHeightInMM = imgHeight / pixelsPerMM;
      
      // Görüntüyü A4 sayfa genişliğine tam sığdır (margin olmadan)
      // Element genişliği zaten 210mm olmalı, oranı hesapla
      const ratio = pdfWidth / imgWidthInMM;
      const scaledHeightInMM = imgHeightInMM * ratio;
      const scaledWidthInMM = pdfWidth; // Tam genişlik kullan (210mm)
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      // Eğer içerik tek sayfaya sığmıyorsa, birden fazla sayfaya böl
      let heightLeft = scaledHeightInMM;
      let position = 0;
      
      // İlk sayfa - tam genişlikte, margin olmadan
      pdf.addImage(imgData, 'PNG', 0, position, scaledWidthInMM, scaledHeightInMM);
      heightLeft -= pdfHeight;
      
      // Ek sayfalar gerekirse
      while (heightLeft > 0) {
        position = heightLeft - scaledHeightInMM;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, scaledWidthInMM, scaledHeightInMM);
        heightLeft -= pdfHeight;
      }
      
      // Öğrenci adını dosya adı olarak kullan
      const studentName = students.find(s => s.id === selectedStudentId)?.name || 'Fasikul';
      const fileName = `${studentName}_${new Date().toISOString().split('T')[0]}.pdf`;
      
      pdf.save(fileName);
    } catch (error) {
      console.error('PDF oluşturma hatası:', error);
      alert('PDF oluşturulurken bir hata oluştu: ' + error.message);
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  // --- YARDIMCI BİLEŞENLER ---
  const TabButton = ({ id, icon: Icon, label }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`flex items-center gap-2 px-4 py-3 w-full text-left rounded-lg transition-colors ${
        activeTab === id 
          ? 'bg-blue-600 text-white shadow-md' 
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      <Icon size={20} />
      <span className="font-medium">{label}</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex font-sans">
      
      {/* SOL MENÜ (Yazdırırken Gizle) */}
      <aside className="w-64 bg-white border-r border-gray-200 p-4 flex flex-col print:hidden shadow-sm z-10">
        <div className="flex items-center gap-2 mb-8 px-2 mt-4">
          <div className="bg-blue-600 p-2 rounded-lg text-white">
            <Layout size={24} />
          </div>
          <h1 className="text-xl font-bold text-gray-800 leading-tight">Dizgi<br/>Sistemi</h1>
        </div>

        <nav className="flex flex-col gap-2 flex-1">
          <TabButton id="upload" icon={Upload} label="1. Soruları Yükle" />
          <TabButton id="data" icon={FileSpreadsheet} label="2. Öğrenci Verisi" />
          <TabButton id="settings" icon={Settings} label="3. Dizgi Ayarları" />
          <TabButton id="preview" icon={Printer} label="4. Önizleme & PDF" />
        </nav>

        <div className="mt-auto pt-4 border-t border-gray-100 flex flex-col items-center gap-2 px-2">
          <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
            <CheckCircle size={12} /> Yerel Depolama Aktif
          </span>
          <span className="text-xs text-gray-400 text-center leading-tight">
            Tüm verileriniz tarayıcınızda otomatik kaydedilir.
          </span>
        </div>
      </aside>

      {/* ANA İÇERİK */}
      <main className="flex-1 overflow-y-auto print:hidden">
        
        {/* TAB 1: GÖRSEL YÜKLEME */}
        {activeTab === 'upload' && (
          <div className="p-4 md:p-8 max-w-5xl mx-auto">
            <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <Upload className="text-blue-600" /> Soru Görsellerini Yükle
            </h2>
            
            {uploadError && (
              <div className="mb-6 bg-red-50 text-red-600 border border-red-200 p-4 rounded-lg flex items-center gap-2 text-sm">
                <AlertCircle size={18} className="shrink-0" />
                <span>{uploadError}</span>
                <button onClick={() => setUploadError('')} className="ml-auto underline whitespace-nowrap hover:text-red-800">Gizle</button>
              </div>
            )}

            <div className={`bg-white p-8 rounded-xl shadow-sm border border-dashed mb-8 text-center transition-colors relative ${isUploading ? 'border-blue-400 bg-blue-50/50' : 'border-gray-200 hover:bg-gray-50'}`}>
              
              {isUploading && (
                <div className="absolute inset-0 bg-white/80 rounded-xl flex flex-col items-center justify-center z-10 backdrop-blur-sm">
                  <Loader2 size={36} className="text-blue-600 animate-spin mb-3" />
                  <p className="font-medium text-blue-800">Sorular işleniyor ve kaydediliyor...</p>
                  <p className="text-xs text-blue-600/80 mt-1">Resimler sıkıştırılıyor ve metinler çıkarılıyor...</p>
                </div>
              )}

              <input 
                type="file" 
                multiple 
                accept="image/*" 
                onChange={handleImageUpload}
                className="hidden" 
                id="file-upload"
                disabled={isUploading}
              />
              <label 
                htmlFor="file-upload" 
                className={`flex flex-col items-center justify-center gap-3 w-full h-full ${isUploading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
              >
                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center">
                  <ImageIcon size={32} />
                </div>
                <div>
                  <span className="text-blue-600 font-medium hover:underline">Görselleri seçin</span> veya sürükleyip bırakın
                  <p className="text-sm text-gray-500 mt-1">İsimlendirme önerisi: KonuAdi_SoruNo.jpg (Örn: Turev_01.jpg)</p>
                </div>
              </label>
            </div>

            {images.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                  <h3 className="font-semibold text-gray-700">Yüklenen Sorular ({images.length})</h3>
                  <p className="text-sm text-gray-500 hidden sm:block">
                    Değişiklikleriniz anında kaydedilir.
                  </p>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-h-[500px] overflow-y-auto">
                  {images.map((img) => (
                    <div key={img.id} className="border border-gray-200 rounded-lg p-3 hover:shadow-md transition-shadow group relative bg-white">
                      <button 
                        onClick={() => removeImage(img.id)}
                        className="absolute top-2 right-2 bg-white/90 p-1.5 rounded-md text-red-500 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 z-10"
                        title="Sil"
                      >
                        <Trash2 size={16} />
                      </button>
                      <div className="h-32 bg-gray-50 rounded-md mb-3 flex items-center justify-center overflow-hidden border border-gray-100">
                        <img src={img.src} alt={img.filename} className="max-h-full max-w-full object-contain mix-blend-multiply" />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs text-gray-400 truncate" title={img.filename}>{img.filename}</p>
                        <div>
                          <label className="text-xs font-medium text-gray-600 mb-1 block">Konu Etiketi:</label>
                          <input 
                            type="text" 
                            defaultValue={img.topic}
                            onBlur={(e) => {
                              if (e.target.value !== img.topic) {
                                updateImageTopic(img.id, e.target.value);
                              }
                            }}
                            className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                            placeholder="Konu girin..."
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: ÖĞRENCİ VERİSİ */}
        {activeTab === 'data' && (
          <div className="p-4 md:p-8 max-w-5xl mx-auto">
            <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <Users className="text-blue-600" /> Öğrenci ve Eksik Konu Verileri
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                  <FileSpreadsheet size={18} className="text-green-600"/> Excel'den Yapıştır
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  Excel tablonuzdaki satırları doğrudan kopyalayıp aşağıdaki kutuya yapıştırabilirsiniz.
                </p>
                <textarea 
                  className="w-full h-40 p-3 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none font-mono"
                  placeholder="Örnek:
Ali Yılmaz	Türev, İntegral
Ayşe Demir	Limit, Olasılık
Mehmet Can	Trigonometri"
                  onPaste={handleExcelPaste}
                  onChange={(e) => e.target.value && handleExcelPaste(e)}
                ></textarea>
                <div className="mt-2 text-xs text-gray-500 flex items-center gap-1">
                  <AlertCircle size={14} /> Otomatik olarak kaydedilir.
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold text-gray-800">Kayıtlı Öğrenciler ({students.length})</h3>
                </div>
                
                {students.length === 0 ? (
                  <div className="h-40 flex flex-col items-center justify-center text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                    <Users size={32} className="mb-2 opacity-50" />
                    <p className="text-sm">Henüz öğrenci eklenmedi.</p>
                  </div>
                ) : (
                  <div className="h-40 overflow-y-auto space-y-2 pr-2">
                    {students.map(student => (
                      <div key={student.id} className="flex justify-between items-center p-3 bg-gray-50 rounded border border-gray-100 hover:bg-gray-100 transition-colors">
                        <div>
                          <p className="font-medium text-gray-800 text-sm">{student.name}</p>
                          <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[200px]">
                            {student.topics.join(', ')}
                          </p>
                        </div>
                        <button 
                          onClick={() => removeStudent(student.id)}
                          className="text-gray-400 hover:text-red-500 p-1"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: DİZGİ AYARLARI */}
        {activeTab === 'settings' && (
          <div className="p-4 md:p-8 max-w-5xl mx-auto">
            <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <Settings className="text-blue-600" /> PDF Dizgi ve Soru Ayarları
            </h2>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Sol: Öğrenci ve Konu Seçimi */}
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                  <h3 className="font-semibold text-gray-800 mb-4">1. Öğrenci Seçin</h3>
                  <select 
                    value={selectedStudentId}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50"
                  >
                    <option value="">-- Öğrenci Seçiniz --</option>
                    {students.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                {selectedStudentId && (
                  <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 animate-fade-in">
                    <h3 className="font-semibold text-gray-800 mb-4 flex items-center justify-between">
                      <span>2. Konu Dağılımı (Soru Kotaları)</span>
                      <span className="text-sm font-normal text-gray-500">
                        Toplam Seçilen: {Object.values(quotas).reduce((a, b) => a + (parseInt(b) || 0), 0)} Soru
                      </span>
                    </h3>
                    
                    <div className="space-y-4">
                      {students.find(s => s.id === selectedStudentId)?.topics.map((topic, idx) => {
                        const topicLower = topic.toLowerCase();
                        const availableCount = images.filter(img => img.topic.toLowerCase() === topicLower).length;
                        
                        return (
                          <div key={idx} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
                            <div>
                              <p className="font-medium text-gray-800 capitalize">{topic}</p>
                              <p className="text-xs text-gray-500 mt-1">Havuzdaki soru: {availableCount}</p>
                            </div>
                            <div className="flex items-center gap-3">
                              <label className="text-sm text-gray-600">Eklenecek Soru:</label>
                              <input 
                                type="number" 
                                min="0"
                                max={availableCount}
                                value={quotas[topicLower] || 0}
                                onChange={(e) => handleQuotaChange(topic, e.target.value)}
                                className="w-20 p-2 text-center border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                            </div>
                          </div>
                        );
                      })}
                      {students.find(s => s.id === selectedStudentId)?.topics.length === 0 && (
                        <p className="text-sm text-amber-600 p-4 bg-amber-50 rounded-lg">Bu öğrenci için eksik konu girilmemiş.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Sağ: Tasarım Ayarları */}
              <div className="space-y-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                  <h3 className="font-semibold text-gray-800 mb-4">3. Sayfa Tasarımı</h3>
                  
                  <div className="space-y-5">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Sütun Düzeni</label>
                      <div className="grid grid-cols-3 gap-2">
                        {[1, 2, 3].map(col => (
                          <button
                            key={col}
                            onClick={() => setDesign({...design, columns: col})}
                            className={`py-2 border rounded-md text-sm font-medium transition-colors ${
                              design.columns === col 
                                ? 'bg-blue-50 border-blue-500 text-blue-700' 
                                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            {col} Sütun
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Başlık Metni</label>
                      <input 
                        type="text" 
                        value={design.headerText}
                        onChange={(e) => setDesign({...design, headerText: e.target.value})}
                        className="w-full p-2.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                      <input 
                        type="checkbox" 
                        id="showName"
                        checked={design.showStudentName}
                        onChange={(e) => setDesign({...design, showStudentName: e.target.checked})}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300"
                      />
                      <label htmlFor="showName" className="text-sm text-gray-700 cursor-pointer">
                        Öğrenci Adını Başlıkta Göster
                      </label>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50 p-6 rounded-xl border border-blue-100">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="text-blue-600 shrink-0 mt-0.5" size={20} />
                    <div>
                      <h4 className="font-semibold text-blue-900 text-sm mb-1">Her şey hazır mı?</h4>
                      <p className="text-xs text-blue-800/80 mb-4">
                        Ayarlarınızı tamamladıktan sonra "Önizleme & PDF" sekmesine geçerek fasikülü oluşturabilirsiniz.
                      </p>
                      <button 
                        onClick={() => setActiveTab('preview')}
                        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
                      >
                        Önizlemeye Geç
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: PDF ÖNİZLEME (Web Görünümü) */}
        {activeTab === 'preview' && (
          <div className="p-4 md:p-8 max-w-7xl mx-auto flex flex-col items-center">
            
            <div className="w-full flex flex-col sm:flex-row justify-between items-center mb-6 bg-white p-4 rounded-xl shadow-sm border border-gray-200 gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-800">Baskı Önizleme</h2>
                <p className="text-sm text-gray-500">
                  {selectedStudentId ? students.find(s=>s.id===selectedStudentId)?.name : 'Öğrenci Seçilmedi'} • {previewQuestions.length} Soru
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={handlePrint}
                  disabled={previewQuestions.length === 0 || isGeneratingPDF}
                  className="flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 px-4 py-2.5 rounded-lg font-medium transition-colors shadow-sm"
                >
                  <Printer size={18} />
                  Yazdır
                </button>
                <button 
                  onClick={handleDownloadPDF}
                  disabled={previewQuestions.length === 0 || isGeneratingPDF}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg font-medium transition-colors shadow-sm"
                >
                  {isGeneratingPDF ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      PDF Oluşturuluyor...
                    </>
                  ) : (
                    <>
                      <Download size={18} />
                      PDF İndir
                    </>
                  )}
                </button>
              </div>
            </div>

            {previewQuestions.length === 0 ? (
              <div className="w-full max-w-2xl bg-white p-12 rounded-xl border border-dashed border-gray-300 text-center">
                <FileText size={48} className="mx-auto text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-800 mb-2">Görüntülenecek Soru Yok</h3>
                <p className="text-gray-500">
                  Lütfen 3. adıma giderek bir öğrenci seçin ve sorular için kota belirleyin.
                </p>
                <button 
                  onClick={() => setActiveTab('settings')}
                  className="mt-6 px-4 py-2 bg-blue-50 text-blue-600 rounded-md font-medium hover:bg-blue-100 transition-colors"
                >
                  Ayarlara Dön
                </button>
              </div>
            ) : (
              <div className="text-sm text-gray-500 mb-6 flex items-center gap-2 bg-blue-50 text-blue-700 p-3 rounded-lg w-full max-w-[210mm]">
                <AlertCircle size={18} className="shrink-0" /> 
                <span>
                  <strong>İpucu:</strong> PDF indirme butonu ile fasikülünüzü direkt PDF dosyası olarak indirebilirsiniz. Yazdırma için "Yazdır" butonunu kullanabilirsiniz.
                </span>
              </div>
            )}
            
          </div>
        )}
      </main>

      {/* YAZDIRILABİLİR ALAN (PDF ÇIKTISI - PROFESYONEL FASİKÜL TASARIMI) */}
      <style>
        {`
          @media print {
            @page { 
              margin: 0;
              size: A4;
            }
            body { 
              -webkit-print-color-adjust: exact; 
              print-color-adjust: exact; 
              background: white; 
              margin: 0;
              padding: 0;
            }
            * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
          }
        `}
      </style>

      <div 
        ref={pdfRef}
        className={`
        ${activeTab === 'preview' ? 'block' : 'hidden'} 
        print:block print:absolute print:left-0 print:top-0 print:m-0 print:p-0 print:w-full print:bg-white
        w-[210mm] min-h-[297mm] mx-auto bg-white shadow-2xl mb-12 origin-top
        print:shadow-none print:w-[210mm] print:min-h-[297mm]
      `}
        style={{ width: '210mm', maxWidth: '210mm', minWidth: '210mm', boxSizing: 'border-box' }}>
        {selectedStudentId && previewQuestions.length > 0 && (
          <div className="p-[2mm] font-sans h-full flex flex-col bg-white relative w-full box-border" style={{ width: '100%', maxWidth: '100%' }}>
            
            {/* ÜST BAŞLIK - REKABETÇİ DENEMELERİ */}
            <div className="mb-4 pb-3 border-b-2 border-gray-300">
              <div className="text-center">
                <h1 className="text-3xl font-black text-blue-900 tracking-wide uppercase mb-2" style={{ letterSpacing: '0.15em' }}>
                  REKABETÇİ DENEMELERİ
                </h1>
                <div className="w-24 h-1 bg-blue-700 mx-auto"></div>
              </div>
            </div>

            {/* ÖĞRENCİ BİLGİ BÖLÜMÜ */}
            {design.showStudentName && (
              <div className="mb-4 pb-3 border-b border-gray-200">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Öğrenci Adı Soyadı</div>
                    <div className="text-lg font-bold text-gray-900">{students.find(s => s.id === selectedStudentId)?.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Tarih</div>
                    <div className="text-sm font-semibold text-gray-700">{new Date().toLocaleDateString('tr-TR')}</div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-100 text-center">
                  <span className="text-xs text-gray-600 font-medium">Toplam Soru Sayısı: </span>
                  <span className="text-sm font-bold text-blue-700">{previewQuestions.length}</span>
                </div>
              </div>
            )}

            {/* FASİKÜL TASARIMI - SÜTUN SAYISINA GÖRE DİNAMİK */}
            <div className="flex-1 flex relative w-full box-border">
              {/* ÇİZGİLER - SÜTUN SAYISINA GÖRE */}
              {design.columns === 2 && (
                <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-gray-400 transform -translate-x-1/2"></div>
              )}
              {design.columns === 3 && (
                <>
                  <div className="absolute left-1/3 top-0 bottom-0 w-[1px] bg-gray-400 transform -translate-x-1/2"></div>
                  <div className="absolute left-2/3 top-0 bottom-0 w-[1px] bg-gray-400 transform -translate-x-1/2"></div>
                </>
              )}

              {/* SÜTUNLAR */}
              {design.columns === 1 ? (
                // TEK SÜTUN
                <div className="w-full flex flex-col gap-4 box-border">
                  {previewQuestions.map((q, index) => (
                    <div key={index} className="break-inside-avoid flex items-start gap-2 w-full">
                      <span className="text-gray-900 font-bold text-sm flex-shrink-0">
                        {index + 1})
                      </span>
                      <div className="flex-1 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap font-mono pdf-text-content" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#1f2937' }}>
                        {q.text || 'Metin çıkarılamadı'}
                      </div>
                    </div>
                  ))}
                </div>
              ) : design.columns === 2 ? (
                // İKİ SÜTUN - Her sütun kendi içinde dikey doldurulur
                <>
                  <div className="w-1/2 pr-[2mm] flex flex-col gap-4 box-border flex-shrink-0" style={{ width: '50%', boxSizing: 'border-box' }}>
                    {previewQuestions
                      .map((q, index) => index)
                      .filter((index) => index % 4 < 2)
                      .map((actualIndex) => {
                        const q = previewQuestions[actualIndex];
                        return (
                          <div key={actualIndex} className="break-inside-avoid flex items-start gap-2 w-full">
                            <span className="text-gray-900 font-bold text-sm flex-shrink-0">
                              {actualIndex + 1})
                            </span>
                            <div className="flex-1 text-xs text-gray-800 leading-relaxed whitespace-pre-wrap font-mono pdf-text-content" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#1f2937' }}>
                              {q.text || 'Metin çıkarılamadı'}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                  <div className="w-1/2 pl-[2mm] flex flex-col gap-4 box-border flex-shrink-0" style={{ width: '50%', boxSizing: 'border-box' }}>
                    {previewQuestions
                      .map((q, index) => index)
                      .filter((index) => index % 4 >= 2)
                      .map((actualIndex) => {
                        const q = previewQuestions[actualIndex];
                        return (
                          <div key={actualIndex} className="break-inside-avoid flex items-start gap-2 w-full">
                            <span className="text-gray-900 font-bold text-sm flex-shrink-0">
                              {actualIndex + 1})
                            </span>
                            <div className="flex-1 text-xs text-gray-800 leading-relaxed whitespace-pre-wrap font-mono pdf-text-content" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#1f2937' }}>
                              {q.text || 'Metin çıkarılamadı'}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </>
              ) : (
                // ÜÇ SÜTUN - Her sütun kendi içinde dikey doldurulur
                <>
                  <div className="w-1/3 pr-[1mm] flex flex-col gap-4 box-border flex-shrink-0" style={{ width: '33.333%', boxSizing: 'border-box' }}>
                    {previewQuestions
                      .map((q, index) => index)
                      .filter((index) => index % 9 < 3)
                      .map((actualIndex) => {
                        const q = previewQuestions[actualIndex];
                        return (
                          <div key={actualIndex} className="break-inside-avoid flex items-start gap-1 w-full">
                            <span className="text-gray-900 font-bold text-xs flex-shrink-0">
                              {actualIndex + 1})
                            </span>
                            <div className="flex-1 text-xs text-gray-800 leading-relaxed whitespace-pre-wrap font-mono pdf-text-content" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#1f2937' }}>
                              {q.text || 'Metin çıkarılamadı'}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                  <div className="w-1/3 px-[1mm] flex flex-col gap-4 box-border flex-shrink-0" style={{ width: '33.333%', boxSizing: 'border-box' }}>
                    {previewQuestions
                      .map((q, index) => index)
                      .filter((index) => index % 9 >= 3 && index % 9 < 6)
                      .map((actualIndex) => {
                        const q = previewQuestions[actualIndex];
                        return (
                          <div key={actualIndex} className="break-inside-avoid flex items-start gap-1 w-full">
                            <span className="text-gray-900 font-bold text-xs flex-shrink-0">
                              {actualIndex + 1})
                            </span>
                            <div className="flex-1 text-xs text-gray-800 leading-relaxed whitespace-pre-wrap font-mono pdf-text-content" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#1f2937' }}>
                              {q.text || 'Metin çıkarılamadı'}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                  <div className="w-1/3 pl-[1mm] flex flex-col gap-4 box-border flex-shrink-0" style={{ width: '33.333%', boxSizing: 'border-box' }}>
                    {previewQuestions
                      .map((q, index) => index)
                      .filter((index) => index % 9 >= 6)
                      .map((actualIndex) => {
                        const q = previewQuestions[actualIndex];
                        return (
                          <div key={actualIndex} className="break-inside-avoid flex items-start gap-1 w-full">
                            <span className="text-gray-900 font-bold text-xs flex-shrink-0">
                              {actualIndex + 1})
                            </span>
                            <div className="flex-1 text-xs text-gray-800 leading-relaxed whitespace-pre-wrap font-mono pdf-text-content" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#1f2937' }}>
                              {q.text || 'Metin çıkarılamadı'}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </>
              )}
            </div>

            {/* ALT BİLGİ - FOOTER */}
            <div className="mt-8 pt-4 border-t border-gray-300">
              <div className="flex justify-between items-center text-xs text-gray-500">
                <div className="text-center flex-1">
                  <span className="font-medium">Bu fasikül </span>
                  <span className="font-bold text-gray-700">{students.find(s => s.id === selectedStudentId)?.name}</span>
                  <span className="font-medium"> için özel olarak hazırlanmıştır.</span>
                </div>
                <div className="text-gray-400 font-bold uppercase tracking-wider ml-4">
                  Başarılar Dileriz
                </div>
              </div>
            </div>

          </div>
        )}
      </div>

    </div>
  );
}
