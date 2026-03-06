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
  const [isGeneratingAllPDFs, setIsGeneratingAllPDFs] = useState(false);
  const [pdfGenerationProgress, setPdfGenerationProgress] = useState({ current: 0, total: 0 });
  const [generatingPDFForStudent, setGeneratingPDFForStudent] = useState(null); // Hangi öğrenci için PDF oluşturuluyor
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

  // OCR ile resimden metin çıkarma - Geliştirilmiş versiyon
  const extractTextFromImage = async (imageSrc) => {
    try {
      const worker = await createWorker('tur+eng'); // Türkçe ve İngilizce dil desteği
      
      // OCR ayarlarını optimize et - sorular için daha iyi okuma
      // pageseg_mode: 11 = Sparse text (sorular için ideal - çok sütunlu, karmaşık düzen)
      await worker.setParameters({
        tessedit_pageseg_mode: '11', // Sparse text - sorular için daha iyi
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:!?()[]{}+-*/=<>≤≥≠≈±×÷∫∑∏√∞αβγδεθλμπστφωΔΩ∑∏∂∇∈∉⊂⊃∪∩∅∀∃⇒⇔∧∨¬→←↑↓°²³⁴⁵⁶⁷⁸⁹⁰¹²³⁴⁵⁶⁷⁸⁹⁰₀₁₂₃₄₅₆₇₈₉ ÇĞİÖŞÜçğıöşü',
        preserve_interword_spaces: '1',
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

  // LGS düzeyinde soru çözme odaklı zorluk analizi
  const analyzeDifficulty = (text) => {
    if (!text || text.trim().length === 0) {
      return 'Bilinmiyor';
    }

    const textLower = text.toLowerCase();
    let solutionSteps = 0; // Çözüm adımları sayısı
    let operationComplexity = 0; // İşlem karmaşıklığı
    let reasoningRequired = 0; // Mantık/akıl yürütme gereksinimi

    // ============================================
    // 1. ÇÖZÜM ADIMLARI ANALİZİ (En önemli faktör)
    // ============================================
    
    // Denklem sayısı = çözüm adımları göstergesi
    const equationCount = (text.match(/=/g) || []).length;
    if (equationCount > 3) {
      solutionSteps += 4; // 3+ denklem = çok adımlı çözüm
      operationComplexity += 2;
    } else if (equationCount > 1) {
      solutionSteps += 2; // 2 denklem = orta adımlı
      operationComplexity += 1;
    } else if (equationCount === 1) {
      solutionSteps += 1; // Tek denklem = basit
    }

    // İşlem işaretleri sayısı (+, -, ×, ÷) = çözüm adımları
    const operationSigns = (text.match(/[+\-×÷]/g) || []).length;
    if (operationSigns > 8) {
      solutionSteps += 3;
      operationComplexity += 2;
    } else if (operationSigns > 4) {
      solutionSteps += 2;
      operationComplexity += 1;
    } else if (operationSigns > 0) {
      solutionSteps += 1;
    }

    // Parantez sayısı = iç içe işlemler = çok adımlı çözüm
    const parenthesesCount = (text.match(/\(/g) || []).length;
    if (parenthesesCount > 4) {
      solutionSteps += 3;
      operationComplexity += 2;
    } else if (parenthesesCount > 2) {
      solutionSteps += 2;
      operationComplexity += 1;
    } else if (parenthesesCount > 0) {
      solutionSteps += 1;
    }

    // İç içe parantez = çok karmaşık işlem
    const nestedParentheses = (text.match(/\([^)]*\([^)]*\)[^)]*\)/g) || []).length;
    if (nestedParentheses > 0) {
      solutionSteps += nestedParentheses * 2;
      operationComplexity += nestedParentheses * 1.5;
    }

    // ============================================
    // 2. İŞLEM KARMAŞIKLIĞI ANALİZİ
    // ============================================

    // Kesirli işlemler (LGS'de zor)
    const fractionPattern = /(\d+\/\d+|\d+,\d+\/\d+|frac)/g;
    const fractionCount = (text.match(fractionPattern) || []).length;
    if (fractionCount > 3) {
      operationComplexity += 3; // Çok kesirli = zor
      solutionSteps += 2;
    } else if (fractionCount > 1) {
      operationComplexity += 2; // Birkaç kesir = orta
      solutionSteps += 1;
    } else if (fractionCount === 1) {
      operationComplexity += 1; // Tek kesir = kolay
    }

    // Üslü sayılar (LGS'de orta-zor)
    const powerPattern = /(\d+\^|\d+\*\*|\d+üzeri|\d+üst|10\^)/gi;
    const powerCount = (text.match(powerPattern) || []).length;
    if (powerCount > 2) {
      operationComplexity += 2.5;
      solutionSteps += 2;
    } else if (powerCount > 0) {
      operationComplexity += 1.5;
      solutionSteps += 1;
    }

    // Köklü sayılar (LGS'de orta-zor)
    const rootPattern = /(√|sqrt|kök|kare kök|küp kök)/gi;
    const rootCount = (text.match(rootPattern) || []).length;
    if (rootCount > 2) {
      operationComplexity += 2.5;
      solutionSteps += 2;
    } else if (rootCount > 0) {
      operationComplexity += 1.5;
      solutionSteps += 1;
    }

    // Ondalık sayılar (işlem karmaşıklığı artırır)
    const decimalCount = (text.match(/\d+[.,]\d+/g) || []).length;
    if (decimalCount > 3) {
      operationComplexity += 1;
    }

    // ============================================
    // 3. LGS KONU KARMAŞIKLIĞI
    // ============================================

    // ZOR LGS KONULARI (Çok adımlı çözüm gerektirir)
    const hardLGSTopics = [
      'cebirsel ifade', 'cebirsel denklem', 'ikinci derece denklem',
      'eşitsizlik', 'mutlak değer', 'mutlak değerli eşitsizlik',
      'fonksiyon', 'doğrusal fonksiyon', 'grafik',
      'olasılık', 'permütasyon', 'kombinasyon',
      'veri analizi', 'istatistik', 'ortalama', 'medyan', 'mod',
      'geometrik şekil', 'alan hesabı', 'hacim hesabı',
      'benzerlik', 'eşlik', 'dönüşüm'
    ];
    
    const hardTopicCount = hardLGSTopics.filter(term => textLower.includes(term)).length;
    if (hardTopicCount > 0) {
      solutionSteps += hardTopicCount * 2;
      operationComplexity += hardTopicCount * 1.5;
      reasoningRequired += hardTopicCount * 1;
    }

    // ORTA LGS KONULARI
    const mediumLGSTopics = [
      'oran', 'orantı', 'doğru orantı', 'ters orantı',
      'yüzde', 'faiz', 'kar', 'zarar',
      'geometri', 'alan', 'çevre', 'hacim',
      'grafik', 'tablo', 'veri',
      'denklem', 'bilinmeyen', 'değişken'
    ];
    
    const mediumTopicCount = mediumLGSTopics.filter(term => textLower.includes(term)).length;
    if (mediumTopicCount > 0) {
      solutionSteps += mediumTopicCount * 1;
      operationComplexity += mediumTopicCount * 0.5;
    }

    // ============================================
    // 4. MANTIK/AKIL YÜRÜTME GEREKSİNİMİ
    // ============================================

    // Problem çözme ifadeleri (akıl yürütme gerektirir)
    const problemSolvingKeywords = [
      'kaç', 'kaçtır', 'kaçıncı', 'hangi', 'hangisi',
      'toplam', 'fark', 'çarpım', 'bölüm',
      'eğer', 'ise', 'koşul', 'durum', 'şart',
      'her', 'bazı', 'tüm', 'hiç', 'en az', 'en fazla',
      'artar', 'azalır', 'değişir', 'sabit'
    ];
    
    const problemKeywordCount = problemSolvingKeywords.filter(keyword => textLower.includes(keyword)).length;
    if (problemKeywordCount > 4) {
      reasoningRequired += 3; // Çok fazla akıl yürütme gerektirir
      solutionSteps += 2;
    } else if (problemKeywordCount > 2) {
      reasoningRequired += 2;
      solutionSteps += 1;
    } else if (problemKeywordCount > 0) {
      reasoningRequired += 1;
    }

    // Koşullu ifadeler (eğer-ise mantığı)
    const conditionalCount = (text.match(/(eğer|ise|koşul|durum|şart|ancak|sadece)/gi) || []).length;
    if (conditionalCount > 2) {
      reasoningRequired += 2;
      solutionSteps += 1;
    } else if (conditionalCount > 0) {
      reasoningRequired += 1;
    }

    // ============================================
    // 5. GRAFİK/ŞEKİL OKUMA (LGS'de zor)
    // ============================================

    const hasGraph = /(grafik|şekil|diagram|çizim|görsel|tablo|sütun|çizgi|pasta)/i.test(text);
    if (hasGraph) {
      reasoningRequired += 2; // Grafik okuma = akıl yürütme
      solutionSteps += 1;
    }

    // ============================================
    // 6. ÇOKTAN SEÇMELİ SORU (Genelde daha kolay)
    // ============================================

    const hasMultipleChoice = /[a-e]\)|\(a\)|\(b\)|\(c\)|\(d\)|\(e\)|seçenek/i.test(text);
    // Çoktan seçmeli sorular genelde daha kolay ama karmaşıksa zor olabilir
    // Bu durumda diğer faktörler zaten zorluğu belirler

    // ============================================
    // 7. FORMÜL KULLANIMI (Çözüm karmaşıklığı)
    // ============================================

    const formulaKeywords = [
      'formül', 'alan formülü', 'hacim formülü', 'çevre formülü',
      'pisagor', 'öklid', 'teorem'
    ];
    
    const formulaCount = formulaKeywords.filter(keyword => textLower.includes(keyword)).length;
    if (formulaCount > 0) {
      operationComplexity += formulaCount * 1.5;
      solutionSteps += formulaCount * 1;
    }

    // ============================================
    // 8. ÇOK ADIMLI PROBLEM ÇÖZME
    // ============================================

    // "Bulunuz", "Hesaplayınız" gibi ifadeler = çözüm adımı
    const solveKeywords = /(bul|bulun|hesapla|hesaplayın|değerini bul|sonucu bul)/gi;
    const solveCount = (text.match(solveKeywords) || []).length;
    if (solveCount > 1) {
      solutionSteps += solveCount * 1.5; // Birden fazla şey isteniyor = çok adımlı
    }

    // ============================================
    // ZORLUK SEVİYESİ BELİRLEME
    // Çözüm adımları ve işlem karmaşıklığına göre
    // ============================================

    // Toplam zorluk skoru
    const totalScore = solutionSteps + operationComplexity + reasoningRequired;

    // ZOR: Çok adımlı çözüm + karmaşık işlemler + akıl yürütme
    if (totalScore >= 12 || (solutionSteps >= 6 && operationComplexity >= 4)) {
      return 'Zor';
    }
    // ORTA: Orta adımlı çözüm + orta karmaşıklık
    else if (totalScore >= 6 || (solutionSteps >= 3 && operationComplexity >= 2)) {
      return 'Orta';
    }
    // KOLAY: Az adımlı çözüm + basit işlemler
    else if (totalScore >= 2 || solutionSteps >= 1) {
      return 'Kolay';
    }
    else {
      return 'Kolay';
    }
  };

  // Metin dosyası okuma
  const readTextFile = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file, 'UTF-8');
  });

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    setIsUploading(true);
    setUploadError('');
    
    const newImages = [];
    
    try {
      for (const file of files) {
        try {
          const fileExtension = file.name.split('.').pop().toLowerCase();
          
          // Txt dosyası ise direkt metin olarak oku
          if (fileExtension === 'txt') {
            const textContent = await readTextFile(file);
            const nameWithoutExt = file.name.split('.').slice(0, -1).join('.');
            const topicGuess = nameWithoutExt.split(/[-_]/)[0].trim();
            const newId = Math.random().toString(36).substr(2, 9);

            // Metin dosyası için zorluk analizi yap
            const difficulty = analyzeDifficulty(textContent);

            newImages.push({
              id: newId,
              filename: file.name,
              topic: topicGuess,
              src: '', // Txt dosyaları için görsel yok
              text: textContent,
              difficulty: difficulty, // Zorluk derecesi
              createdAt: Date.now()
            });
          } else {
            // Görsel dosyası ise normal işlem - OCR yapıp zorluk analizi yap
            const dataUrl = await readFileAsDataURL(file);
            const compressedSrc = await compressImage(dataUrl);

            // LocalStorage boyut sınırı kontrolü (yaklaşık 5MB per item limit)
            if (compressedSrc.length > 1048400) {
              throw new Error(`"${file.name}" boyutu çok büyük. Lütfen daha düşük çözünürlüklü bir görsel seçin.`);
            }

            const nameWithoutExt = file.name.split('.').slice(0, -1).join('.');
            const topicGuess = nameWithoutExt.split(/[-_]/)[0].trim();
            const newId = Math.random().toString(36).substr(2, 9);

            // OCR ile metni çıkar ve zorluk analizi yap
            let extractedText = '';
            let difficulty = 'Bilinmiyor';
            try {
              extractedText = await extractTextFromImage(compressedSrc);
              if (extractedText && extractedText.trim().length > 0) {
                difficulty = analyzeDifficulty(extractedText);
              }
            } catch (error) {
              console.error('OCR veya zorluk analizi hatası:', error);
            }

            // Görseli ekle (OCR metni ve zorluk derecesi ile)
            newImages.push({
              id: newId,
              filename: file.name,
              topic: topicGuess,
              src: compressedSrc,
              text: extractedText, // OCR metni
              difficulty: difficulty, // Zorluk derecesi
              createdAt: Date.now()
            });
          }
        } catch (error) {
          console.error("Dosya yükleme hatası:", error);
          setUploadError(prev => prev ? `${prev}\n${file.name}: ${error.message}` : `${file.name}: ${error.message}`);
        }
      }
      
      // Tüm yeni resimleri state'e ekle
      if (newImages.length > 0) {
        setImages(prev => [...newImages, ...prev]);
      }
    } catch (error) {
      console.error("Genel yükleme hatası:", error);
      setUploadError(error.message || 'Dosya yüklenirken bir hata oluştu.');
    } finally {
      setIsUploading(false);
      // Aynı dosyaları tekrar yükleyebilmek için input'u temizle
      e.target.value = '';
    }
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
  // Belirli bir öğrenci için soruları hesapla
  const getQuestionsForStudent = (studentId) => {
    const student = students.find(s => s.id === studentId);
    if (!student) return [];

    let finalQs = [];
    student.topics.forEach(topic => {
      const topicLower = topic.toLowerCase();
      const availableImages = images.filter(img => img.topic.toLowerCase() === topicLower);
      // Tüm mevcut soruları seç
      finalQs = [...finalQs, ...availableImages];
    });

    return finalQs;
  };

  // Tek öğrenci durumunda otomatik seç
  useEffect(() => {
    if (students.length === 1 && !selectedStudentId) {
      setSelectedStudentId(students[0].id);
    }
  }, [students.length, selectedStudentId]);

  // Öğrenci seçildiğinde otomatik olarak tüm soruları seç (tek öğrenci durumu için)
  // Sadece settings sekmesinde çalışır
  useEffect(() => {
    // Preview sekmesindeyse bu useEffect'i çalıştırma
    if (activeTab !== 'settings') {
      return;
    }

    if (students.length > 1) {
      // Birden fazla öğrenci varsa, settings sekmesinde selectedStudentId yoksa temizle
      if (!selectedStudentId) {
        setPreviewQuestions([]);
        setQuotas({});
      }
      return;
    }

    if (!selectedStudentId) {
      setPreviewQuestions([]);
      setQuotas({});
      return;
    }

    const student = students.find(s => s.id === selectedStudentId);
    if (!student) return;

    // Otomatik olarak her konu için mevcut tüm soruları seç
    const autoQuotas = {};
    student.topics.forEach(topic => {
      const topicLower = topic.toLowerCase();
      const availableImages = images.filter(img => img.topic.toLowerCase() === topicLower);
      autoQuotas[topicLower] = availableImages.length; // Mevcut tüm soruları seç
    });

    // Quotas'ı otomatik olarak güncelle
    setQuotas(autoQuotas);
  }, [selectedStudentId, images, students, activeTab]);

  // Quotas değiştiğinde soruları güncelle (tek öğrenci durumu için)
  // Sadece settings sekmesinde çalışır
  useEffect(() => {
    // Preview sekmesindeyse bu useEffect'i çalıştırma
    if (activeTab !== 'settings') {
      return;
    }

    if (students.length > 1) {
      return; // Birden fazla öğrenci varsa bu useEffect'i çalıştırma
    }

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
  }, [selectedStudentId, quotas, images, students, activeTab]);

  // Belirli bir öğrenci için PDF indir
  const handleDownloadPDFForStudent = async (studentId) => {
    const studentQuestions = getQuestionsForStudent(studentId);
    if (studentQuestions.length === 0) {
      alert('Bu öğrenci için soru bulunamadı.');
      return;
    }

    setGeneratingPDFForStudent(studentId); // Bu öğrenci için PDF oluşturuluyor
    
    try {
      const result = await generatePDFForStudent(studentId, studentQuestions);
      if (result) {
        const fileName = `${result.studentName}_${new Date().toISOString().split('T')[0]}.pdf`;
        result.pdf.save(fileName);
      }
    } catch (error) {
      console.error('PDF oluşturma hatası:', error);
      alert('PDF oluşturulurken bir hata oluştu: ' + error.message);
    } finally {
      setGeneratingPDFForStudent(null); // PDF oluşturma tamamlandı
    }
  };

  // Belirli bir öğrenci için önizlemeyi göster
  const handlePreviewForStudent = (studentId) => {
    setSelectedStudentId(studentId);
    const studentQuestions = getQuestionsForStudent(studentId);
    setPreviewQuestions(studentQuestions);
    setActiveTab('preview');
  };

  // Soru boyutunu hesapla (0-1000 arası değer)
  const calculateQuestionSize = (q) => {
    if (q.src) {
      const base64Length = q.src.length;
      if (base64Length < 30000) return 150; // Çok küçük görsel
      if (base64Length < 80000) return 250; // Küçük görsel
      if (base64Length < 150000) return 400; // Orta görsel
      return 600; // Büyük görsel
    } else if (q.text) {
      const textLength = q.text.length;
      const lineCount = (q.text.match(/\n/g) || []).length + 1;
      if (textLength < 150 && lineCount < 5) return 120; // Çok kısa metin
      if (textLength < 300 && lineCount < 10) return 200; // Kısa metin
      if (textLength < 600 && lineCount < 20) return 350; // Orta metin
      return 550; // Uzun metin
    }
    return 300; // Varsayılan
  };

  // Soru boyutlarını kontrol ederek sayfa başına soru sayısını belirle (optimize edilmiş)
  const calculateQuestionsPerPage = (questions) => {
    if (questions.length === 0) return 4;
    
    let totalSize = 0;
    let smallCount = 0;
    let largeCount = 0;
    let minSize = Infinity;
    let maxSize = 0;
    
    questions.forEach(q => {
      const size = calculateQuestionSize(q);
      totalSize += size;
      if (size < minSize) minSize = size;
      if (size > maxSize) maxSize = size;
      if (size < 200) smallCount++;
      if (size >= 400) largeCount++;
    });
    
    const avgSize = totalSize / questions.length;
    const smallRatio = smallCount / questions.length;
    const largeRatio = largeCount / questions.length;
    const sizeRange = maxSize - minSize;
    
    // Büyük sorular varsa 4 soru/sayfa
    if (largeRatio > 0.3 || avgSize >= 400) {
      return 4; // 2x2 düzen - büyük sorular için
    }
    
    // Küçük sorular için boşlukları doldur ama çok sıkışık yapma
    // Sorular çok küçükse ve boyutları benzer ise daha fazla soru ekle
    if (smallRatio > 0.7 && avgSize < 200 && sizeRange < 100) {
      return 10; // 5x2 düzen - çok küçük ve benzer boyutlu sorular için
    } else if (smallRatio > 0.7 || avgSize < 200) {
      return 8; // 4x2 düzen - küçük sorular için
    } else if (smallRatio > 0.5 || avgSize < 250) {
      return 6; // 3x2 düzen - orta-küçük sorular için
    } else if (smallRatio > 0.3 || avgSize < 300) {
      return 4; // 2x2 düzen - orta sorular için
    } else {
      return 4; // 2x2 düzen - varsayılan
    }
  };

  // Sayfa için dinamik soru yerleştirme - boşlukları doldur
  const fillPageWithQuestions = (remainingQuestions, baseQuestionsPerPage) => {
    if (remainingQuestions.length === 0) return { pageQuestions: [], remaining: [] };
    
    // İlk olarak temel sayıda soru al
    let pageQuestions = remainingQuestions.slice(0, baseQuestionsPerPage);
    let remaining = remainingQuestions.slice(baseQuestionsPerPage);
    
    // Sayfadaki soruları analiz et
    let pageTotalSize = 0;
    let pageSmallCount = 0;
    let pageMaxSize = 0;
    let pageMinSize = Infinity;
    
    pageQuestions.forEach(q => {
      const size = calculateQuestionSize(q);
      pageTotalSize += size;
      if (size < 200) pageSmallCount++;
      if (size > pageMaxSize) pageMaxSize = size;
      if (size < pageMinSize) pageMinSize = size;
    });
    
    const pageAvgSize = pageTotalSize / pageQuestions.length;
    const pageSmallRatio = pageSmallCount / pageQuestions.length;
    
    // Eğer sayfadaki sorular küçükse ve sayfa dolu değilse, daha fazla soru ekle
    // Özellikle 4 küçük soru varsa ve yatay/küçük sorular ise, daha agresif ekle
    // Koşul: Sayfada küçük sorular varsa veya ortalama boyut küçükse
    // Özellikle sayfada 4 soru varsa ve bunlar küçükse, mutlaka daha fazla soru ekle
    const isFourSmallQuestions = pageQuestions.length === 4 && pageSmallRatio >= 0.75 && pageAvgSize < 300;
    const shouldFillPage = (isFourSmallQuestions || pageSmallRatio > 0.5 || pageAvgSize < 300) && remaining.length > 0;
    
    if (shouldFillPage) {
      // Kalan sorulardan küçük/orta olanları bul (daha esnek)
      const smallRemaining = remaining.filter(q => {
        const size = calculateQuestionSize(q);
        return size < 300; // 300'den küçük sorular (daha esnek)
      });
      
      if (smallRemaining.length > 0) {
        // Küçük sorular varsa, sayfaya sığacak kadar ekle
        // Çok küçük sorular için daha fazla soru ekle - boşluk kalmaması için
        let maxQuestions;
        if (pageAvgSize < 150) {
          maxQuestions = 14; // Çok küçük sorular için 14 soru (7x2) - maksimum doldurma
        } else if (pageAvgSize < 200) {
          maxQuestions = 12; // Küçük sorular için 12 soru (6x2)
        } else if (pageAvgSize < 250) {
          maxQuestions = 10; // Orta-küçük sorular için 10 soru (5x2)
        } else {
          maxQuestions = 8; // Orta sorular için 8 soru (4x2)
        }
        
        const additionalCount = Math.min(smallRemaining.length, maxQuestions - pageQuestions.length);
        
        if (additionalCount > 0) {
          pageQuestions = [...pageQuestions, ...smallRemaining.slice(0, additionalCount)];
          // Eklenen soruları remaining'den çıkar
          const addedIds = new Set(smallRemaining.slice(0, additionalCount).map(q => q.id));
          remaining = remaining.filter(q => !addedIds.has(q.id));
        }
      } else if (remaining.length > 0) {
        // Küçük soru yoksa ama büyük sorular varsa, onları ekle
        const maxQuestions = 6; // Büyük sorular için maksimum 6 soru
        const additionalCount = Math.min(remaining.length, maxQuestions - pageQuestions.length);
        
        if (additionalCount > 0) {
          pageQuestions = [...pageQuestions, ...remaining.slice(0, additionalCount)];
          remaining = remaining.slice(additionalCount);
        }
      }
    }
    
    return { pageQuestions, remaining };
  };

  // Sayfa soruları için gap değerini hesapla (soru sayısına ve boyutuna göre optimize)
  const calculateGapForPage = (pageQuestions, questionsPerPage) => {
    if (pageQuestions.length === 0) return '20px';
    
    let maxSize = 0;
    let minSize = Infinity;
    let totalSize = 0;
    
    pageQuestions.forEach(q => {
      const size = calculateQuestionSize(q);
      totalSize += size;
      if (size > maxSize) maxSize = size;
      if (size < minSize) minSize = size;
    });
    
    const avgSize = totalSize / pageQuestions.length;
    
    // Sayfa başına soru sayısına göre gap ayarla
    // Daha fazla soru varsa gap'i biraz azalt ama çok sıkışık yapma
    if (questionsPerPage >= 14) {
      // Çok fazla soru varsa (14 soru) - minimum boşluk ama okunabilir
      if (maxSize >= 200) return '10px';
      return '8px';
    } else if (questionsPerPage >= 12) {
      // Çok fazla soru varsa (12 soru) - minimum boşluk ama okunabilir
      if (maxSize >= 200) return '12px';
      return '10px';
    } else if (questionsPerPage >= 10) {
      // Çok fazla soru varsa (10 soru) - orta boşluk
      if (maxSize >= 300) return '18px';
      return '14px';
    } else if (questionsPerPage >= 8) {
      // 8 soru varsa - yeterli boşluk
      if (maxSize >= 300) return '20px';
      return '16px';
    } else if (questionsPerPage >= 6) {
      // 6 soru varsa - normal boşluk
      if (maxSize >= 400) return '24px';
      if (maxSize >= 300) return '20px';
      return '18px';
    } else {
      // 4 soru varsa - rahat boşluk
      if (maxSize >= 400) return '24px';
      if (maxSize >= 300) return '22px';
      return '20px';
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // Belirli bir öğrenci için PDF oluştur (yeniden kullanılabilir fonksiyon)
  const generatePDFForStudent = async (studentId, studentQuestions) => {
    if (!studentId || !studentQuestions || studentQuestions.length === 0) {
      return null;
    }

    // Soru boyutlarına göre temel sayfa başına soru sayısını belirle
    const baseQuestionsPerPage = calculateQuestionsPerPage(studentQuestions);
    
    // Dinamik sayfa oluşturma - boşlukları doldur
    const pages = [];
    let remainingQuestions = [...studentQuestions];
    
    while (remainingQuestions.length > 0) {
      const result = fillPageWithQuestions(remainingQuestions, baseQuestionsPerPage);
      pages.push(result.pageQuestions);
      remainingQuestions = result.remaining;
    }

    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = 210; // mm
    const pdfHeight = 297; // mm
    const elementWidth = 794; // 210mm in pixels at 96 DPI

    const student = students.find(s => s.id === studentId);
    const studentName = student?.name || 'Fasikul';

    // Her sayfa için ayrı ayrı işle
    let globalQuestionIndex = 0; // Global soru indexi
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const pageQuestions = pages[pageIndex];
      const actualQuestionsPerPage = pageQuestions.length; // Gerçek soru sayısı
      
      // Bu sayfa için gap değerini hesapla (soru boyutlarına ve sayısına göre optimize)
      const gapValue = calculateGapForPage(pageQuestions, actualQuestionsPerPage);
      
      // Geçici bir sayfa elementi oluştur
      const tempPageElement = document.createElement('div');
      tempPageElement.className = 'w-[210mm] min-h-[297mm] bg-white';
      tempPageElement.style.width = '210mm';
      tempPageElement.style.maxWidth = '210mm';
      tempPageElement.style.minWidth = '210mm';
      tempPageElement.style.boxSizing = 'border-box';
      tempPageElement.style.position = 'absolute';
      tempPageElement.style.left = '-9999px';
      tempPageElement.style.top = '0';
      document.body.appendChild(tempPageElement);

      // Sayfa içeriğini oluştur
      tempPageElement.innerHTML = `
        <div class="p-[2mm] font-sans flex flex-col bg-white relative w-full box-border" style="width: 100%; maxWidth: 100%; min-height: 297mm; height: 100%;">
          <!-- ÜST BAŞLIK - YENİ TASARIM -->
          <div class="mb-4 relative" style="background: linear-gradient(135deg, #141b35 0%, #8e34e9 100%); padding: 16px 20px; border-radius: 8px; margin-bottom: 16px;">
            <div class="flex items-center justify-between">
              <img src="/rbdlogo.png" alt="RBD Logo" style="height: 50px; width: auto; object-fit: contain; flex-shrink: 0;" />
              <div class="text-center flex-1">
                <h1 class="text-2xl font-black text-white tracking-wide uppercase mb-2" style="letter-spacing: 0.15em; text-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                  REKABETÇİ DENEMELERİ
                </h1>
                <div class="w-32 h-1 bg-white mx-auto" style="opacity: 0.9; border-radius: 2px;"></div>
              </div>
              <div class="text-right" style="flex-shrink: 0; width: auto;">
                <div class="text-sm font-bold text-white uppercase" style="font-size: 11px; letter-spacing: 0.1em; line-height: 1.4;">
                  Öğrenciye Özel<br/>Çalışma Fasikülü
                </div>
              </div>
            </div>
          </div>

          <!-- ÖĞRENCİ BİLGİ BÖLÜMÜ - YENİ TASARIM -->
          ${design.showStudentName ? `
            <div class="mb-4" style="background: linear-gradient(135deg, rgba(142, 52, 233, 0.1) 0%, rgba(20, 27, 53, 0.1) 100%); padding: 12px 16px; border-radius: 8px; border-left: 4px solid #8e34e9; margin-bottom: 16px;">
              <div class="flex justify-between items-center">
                <div>
                  <div class="text-xs uppercase font-semibold mb-1" style="color: #8e34e9;">Öğrenci Adı Soyadı</div>
                  <div class="text-lg font-bold" style="color: #141b35;">${studentName}</div>
                </div>
                <div class="text-right">
                  <div class="text-xs uppercase font-semibold mb-1" style="color: #8e34e9;">Tarih</div>
                  <div class="text-sm font-semibold" style="color: #141b35;">${new Date().toLocaleDateString('tr-TR')}</div>
                </div>
              </div>
            </div>
          ` : ''}

          <!-- SORULAR - 2 SÜTUN (Dinamik soru sayısı) -->
          <div class="flex-1 flex relative w-full box-border">
            <!-- ÜST ÇİZGİ -->
            <div class="absolute left-1/2 top-0 w-[1px] transform -translate-x-1/2" style="background-color: #8e34e9; height: calc(50% - 120px);"></div>
            <!-- ORTA METİN -->
            <div class="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10" style="padding: 8px 4px; background-color: white;">
              <div class="text-xs font-bold uppercase" style="color: #8e34e9; writing-mode: vertical-rl; text-orientation: upright; font-size: 9px; letter-spacing: 0.1em; line-height: 1.2;">
                REKABETÇİ DENEMELERİ
              </div>
            </div>
            <!-- ALT ÇİZGİ -->
            <div class="absolute left-1/2 bottom-0 w-[1px] transform -translate-x-1/2" style="background-color: #8e34e9; top: calc(50% + 120px); height: calc(50% - 120px);"></div>
            
            <!-- SOL SÜTUN -->
            <div class="w-1/2 pr-[2mm] flex flex-col box-border flex-shrink-0" style="width: 50%; box-sizing: border-box; gap: ${gapValue};">
              ${pageQuestions.slice(0, Math.ceil(actualQuestionsPerPage / 2)).map((q, idx) => {
                const currentGlobalIndex = globalQuestionIndex + idx;
                return `
                  <div class="break-inside-avoid flex items-start gap-2 w-full">
                    <span class="text-gray-900 font-bold text-sm flex-shrink-0">
                      ${currentGlobalIndex + 1})
                    </span>
                    <div class="flex-1">
                      ${q.src ? 
                        `<img src="${q.src}" alt="${q.filename}" class="max-w-full h-auto" />` : 
                        `<div class="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap font-mono pdf-text-content" style="font-family: monospace; white-space: pre-wrap; word-break: break-word; color: #1f2937;">${q.text || 'İçerik yok'}</div>`
                      }
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
            
            <!-- SAĞ SÜTUN -->
            <div class="w-1/2 pl-[2mm] flex flex-col box-border flex-shrink-0" style="width: 50%; box-sizing: border-box; gap: ${gapValue};">
              ${pageQuestions.slice(Math.ceil(actualQuestionsPerPage / 2), actualQuestionsPerPage).map((q, idx) => {
                const currentGlobalIndex = globalQuestionIndex + Math.ceil(actualQuestionsPerPage / 2) + idx;
                return `
                  <div class="break-inside-avoid flex items-start gap-2 w-full">
                    <span class="text-gray-900 font-bold text-sm flex-shrink-0">
                      ${currentGlobalIndex + 1})
                    </span>
                    <div class="flex-1">
                      ${q.src ? 
                        `<img src="${q.src}" alt="${q.filename}" class="max-w-full h-auto" />` : 
                        `<div class="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap font-mono pdf-text-content" style="font-family: monospace; white-space: pre-wrap; word-break: break-word; color: #1f2937;">${q.text || 'İçerik yok'}</div>`
                      }
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- ALT BİLGİ - FOOTER - YENİ TASARIM -->
          <div class="mt-auto relative" style="background: linear-gradient(135deg, #141b35 0%, #8e34e9 100%); padding: 14px 20px; border-radius: 8px; margin-top: auto;">
            <div class="flex justify-between items-center text-xs">
              <div class="text-left">
                <span class="font-medium text-white" style="opacity: 0.95;">Bu fasikül </span>
                <span class="font-bold text-white">${studentName}</span>
                <span class="font-medium text-white" style="opacity: 0.95;"> için özel olarak hazırlanmıştır.</span>
              </div>
              <div class="text-white font-bold uppercase tracking-wider ml-4" style="font-size: 11px; letter-spacing: 0.2em; opacity: 0.95;">
                Başarılar Dileriz
              </div>
            </div>
          </div>
        </div>
      `;

      // Metinlerin render edilmesi için bekleme
      await new Promise(resolve => setTimeout(resolve, 300));

      // Canvas oluştur
      const canvas = await html2canvas(tempPageElement, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        logging: false,
        backgroundColor: '#ffffff',
        width: elementWidth,
        windowWidth: elementWidth,
        foreignObjectRendering: false,
        onclone: (clonedDoc) => {
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
        }
      });
      
      const imgData = canvas.toDataURL('image/png');
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      
      // Piksel'i mm'ye dönüştür
      const pixelsPerMM = (96 * 2) / 25.4;
      const imgWidthInMM = imgWidth / pixelsPerMM;
      const imgHeightInMM = imgHeight / pixelsPerMM;
      
      // Görüntüyü A4 sayfa genişliğine sığdır
      const ratio = pdfWidth / imgWidthInMM;
      const scaledHeightInMM = imgHeightInMM * ratio;
      const scaledWidthInMM = pdfWidth;
      
      // İlk sayfa değilse yeni sayfa ekle
      if (pageIndex > 0) {
        pdf.addPage();
      }
      
      // Sayfayı PDF'e ekle
      pdf.addImage(imgData, 'PNG', 0, 0, scaledWidthInMM, scaledHeightInMM);
      
      // Geçici elementi temizle
      document.body.removeChild(tempPageElement);
      
      // Global soru indexini güncelle
      globalQuestionIndex += actualQuestionsPerPage;
    }
    
    return { pdf, studentName };
  };

  // Tek öğrenci için PDF indir
  const handleDownloadPDF = async () => {
    if (!selectedStudentId || previewQuestions.length === 0) return;
    
    setIsGeneratingPDF(true);
    
    try {
      const result = await generatePDFForStudent(selectedStudentId, previewQuestions);
      if (result) {
        const fileName = `${result.studentName}_${new Date().toISOString().split('T')[0]}.pdf`;
        result.pdf.save(fileName);
      }
    } catch (error) {
      console.error('PDF oluşturma hatası:', error);
      alert('PDF oluşturulurken bir hata oluştu: ' + error.message);
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  // Tüm öğrenciler için PDF indir
  const handleDownloadAllPDFs = async () => {
    if (students.length === 0) {
      alert('PDF oluşturmak için öğrenci bulunamadı.');
      return;
    }

    setIsGeneratingAllPDFs(true);
    setPdfGenerationProgress({ current: 0, total: students.length });

    try {
      for (let i = 0; i < students.length; i++) {
        const student = students[i];
        
        // Öğrenci için soruları hazırla
        let studentQuestions = [];
        student.topics.forEach(topic => {
          const topicLower = topic.toLowerCase();
          const availableImages = images.filter(img => img.topic.toLowerCase() === topicLower);
          studentQuestions = [...studentQuestions, ...availableImages];
        });

        if (studentQuestions.length === 0) {
          console.warn(`${student.name} için soru bulunamadı, atlanıyor.`);
          setPdfGenerationProgress({ current: i + 1, total: students.length });
          continue;
        }

        // PDF oluştur
        const result = await generatePDFForStudent(student.id, studentQuestions);
        if (result) {
          const fileName = `${result.studentName}_${new Date().toISOString().split('T')[0]}.pdf`;
          result.pdf.save(fileName);
          
          // Her PDF arasında kısa bir bekleme (tarayıcının dosyaları düzgün indirmesi için)
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        setPdfGenerationProgress({ current: i + 1, total: students.length });
      }

      alert(`Tüm öğrenciler için PDF'ler başarıyla oluşturuldu! (${students.length} öğrenci)`);
    } catch (error) {
      console.error('Toplu PDF oluşturma hatası:', error);
      alert('PDF\'ler oluşturulurken bir hata oluştu: ' + error.message);
    } finally {
      setIsGeneratingAllPDFs(false);
      setPdfGenerationProgress({ current: 0, total: 0 });
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
          
          {/* PDF İNDİR BUTONU - SADECE ÖNİZLEME SEKMESİNDE GÖRÜNÜR */}
          {activeTab === 'preview' && (
            <button
              onClick={handleDownloadPDF}
              disabled={previewQuestions.length === 0 || isGeneratingPDF}
              className="flex items-center justify-center gap-2 px-4 py-3 w-full text-left rounded-lg transition-colors bg-blue-600 text-white shadow-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600 mt-2"
            >
              {isGeneratingPDF ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  <span className="font-medium">PDF Oluşturuluyor...</span>
                </>
              ) : (
                <>
                  <Download size={20} />
                  <span className="font-medium">PDF İndir</span>
                </>
              )}
            </button>
          )}
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
                  <p className="text-xs text-blue-600/80 mt-1">Resimler sıkıştırılıyor ve zorluk analizi yapılıyor...</p>
                </div>
              )}

              <input 
                type="file" 
                multiple 
                accept="image/*,.txt" 
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
                  <span className="text-blue-600 font-medium hover:underline">Dosyaları seçin</span> veya sürükleyip bırakın
                  <p className="text-sm text-gray-500 mt-1">Görsel dosyaları (JPG, PNG) veya metin dosyaları (.txt) yükleyebilirsiniz</p>
                  <p className="text-xs text-gray-400 mt-1">İsimlendirme önerisi: KonuAdi_SoruNo.jpg (Örn: Turev_01.jpg)</p>
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
                        {img.src ? (
                          <img src={img.src} alt={img.filename} className="max-h-full max-w-full object-contain mix-blend-multiply" />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-gray-400">
                            <FileText size={32} />
                            <span className="text-xs mt-1">Metin Dosyası</span>
                          </div>
                        )}
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
                        {/* Zorluk Derecesi */}
                        <div className="mt-2">
                          <label className="text-xs font-medium text-gray-600 mb-1 block">Zorluk Derecesi:</label>
                          <div className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold ${
                            img.difficulty === 'Zor' ? 'bg-red-100 text-red-700 border border-red-200' :
                            img.difficulty === 'Orta' ? 'bg-yellow-100 text-yellow-700 border border-yellow-200' :
                            img.difficulty === 'Kolay' ? 'bg-green-100 text-green-700 border border-green-200' :
                            'bg-gray-100 text-gray-600 border border-gray-200'
                          }`}>
                            {img.difficulty || 'Bilinmiyor'}
                          </div>
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
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                <Users className="text-blue-600" /> Öğrenci ve Eksik Konu Verileri
              </h2>
            </div>

            {/* İlerleme Çubuğu */}
            {isGeneratingAllPDFs && pdfGenerationProgress.total > 0 && (
              <div className="mb-6 bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                  <div 
                    className="bg-green-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(pdfGenerationProgress.current / pdfGenerationProgress.total) * 100}%` }}
                  ></div>
                </div>
                <p className="text-xs text-gray-500 text-center">
                  {pdfGenerationProgress.current} / {pdfGenerationProgress.total} öğrenci işlendi
                </p>
              </div>
            )}

            {images.length === 0 && students.length > 0 && (
              <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg flex items-center gap-2">
                <AlertCircle size={18} />
                <span className="text-sm">PDF oluşturmak için önce soruları yükleyin.</span>
              </div>
            )}

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
          <div className="p-4 md:p-8 max-w-7xl mx-auto">
            <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <Settings className="text-blue-600" /> PDF Dizgi ve Soru Ayarları
            </h2>

            {students.length === 0 ? (
              <div className="bg-white p-12 rounded-xl shadow-sm border border-gray-200 text-center">
                <Users size={48} className="mx-auto text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-800 mb-2">Henüz Öğrenci Eklenmedi</h3>
                <p className="text-gray-500 mb-6">
                  PDF oluşturmak için önce öğrenci verilerini ekleyin.
                </p>
                <button 
                  onClick={() => setActiveTab('data')}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                >
                  Öğrenci Verisi Ekle
                </button>
              </div>
            ) : students.length === 1 ? (
              // Tek öğrenci durumu - Eski sistem
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Sol: Öğrenci ve Konu Seçimi */}
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <h3 className="font-semibold text-gray-800 mb-4">Öğrenci Bilgileri</h3>
                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-100">
                      <p className="font-medium text-gray-800 text-lg">{students[0].name}</p>
                      <p className="text-sm text-gray-500 mt-2">
                        Konular: {students[0].topics.join(', ')}
                      </p>
                    </div>
                  </div>

                  {selectedStudentId && (
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 animate-fade-in">
                      <h3 className="font-semibold text-gray-800 mb-4 flex items-center justify-between">
                        <span>Otomatik Soru Seçimi</span>
                        <span className="text-sm font-normal text-gray-500">
                          Toplam Seçilen: {Object.values(quotas).reduce((a, b) => a + (parseInt(b) || 0), 0)} Soru
                        </span>
                      </h3>
                      
                      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-sm text-blue-800 flex items-center gap-2">
                          <CheckCircle size={16} />
                          <span>Her konu için mevcut tüm sorular otomatik olarak seçilmiştir.</span>
                        </p>
                      </div>
                      
                      <div className="space-y-4">
                        {students.find(s => s.id === selectedStudentId)?.topics.map((topic, idx) => {
                          const topicLower = topic.toLowerCase();
                          const availableCount = images.filter(img => img.topic.toLowerCase() === topicLower).length;
                          const selectedCount = quotas[topicLower] || 0;
                          
                          return (
                            <div key={idx} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-100">
                              <div>
                                <p className="font-medium text-gray-800 capitalize">{topic}</p>
                                <p className="text-xs text-gray-500 mt-1">
                                  {selectedCount > 0 ? (
                                    <span className="text-green-600 font-semibold">{selectedCount} soru seçildi</span>
                                  ) : (
                                    <span className="text-amber-600">Bu konu için soru bulunamadı</span>
                                  )}
                                </p>
                              </div>
                              <div className="flex items-center gap-3">
                                <label className="text-sm text-gray-600">Havuz:</label>
                                <span className="text-sm font-semibold text-gray-700">{availableCount} soru</span>
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
                    <h3 className="font-semibold text-gray-800 mb-4">Sayfa Tasarımı</h3>
                    
                    <div className="space-y-5">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Sütun Düzeni</label>
                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                          <p className="text-sm text-blue-800 font-medium">2 Sütun (Sabit)</p>
                          <p className="text-xs text-blue-600 mt-1">Her sayfada 4 soru (2x2) gösterilir</p>
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
            ) : (
              // Birden fazla öğrenci durumu - Kart sistemi
              <div className="space-y-6">
                {/* Tasarım Ayarları - Üstte */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                  <h3 className="font-semibold text-gray-800 mb-4">Sayfa Tasarımı</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Sütun Düzeni</label>
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                        <p className="text-sm text-blue-800 font-medium">2 Sütun (Sabit)</p>
                        <p className="text-xs text-blue-600 mt-1">Her sayfada 4 soru (2x2) gösterilir</p>
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

                {/* Öğrenci Kartları */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">Öğrenciler ({students.length})</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {students.map(student => {
                      const studentQuestions = getQuestionsForStudent(student.id);
                      const totalQuestions = studentQuestions.length;
                      
                      return (
                        <div key={student.id} className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                          <div className="mb-4">
                            <h4 className="text-lg font-bold text-gray-800 mb-2">{student.name}</h4>
                            <div className="space-y-2">
                              {student.topics.length > 0 ? (
                                student.topics.map((topic, idx) => {
                                  const topicLower = topic.toLowerCase();
                                  const availableCount = images.filter(img => img.topic.toLowerCase() === topicLower).length;
                                  return (
                                    <div key={idx} className="flex items-center justify-between text-sm">
                                      <span className="text-gray-600 capitalize">{topic}</span>
                                      <span className={`font-semibold ${availableCount > 0 ? 'text-green-600' : 'text-amber-600'}`}>
                                        {availableCount} soru
                                      </span>
                                    </div>
                                  );
                                })
                              ) : (
                                <p className="text-xs text-amber-600">Konu girilmemiş</p>
                              )}
                            </div>
                            <div className="mt-3 pt-3 border-t border-gray-200">
                              <p className="text-xs text-gray-500">
                                Toplam: <span className="font-semibold text-gray-700">{totalQuestions} soru</span>
                              </p>
                            </div>
                          </div>
                          
                          <div className="flex flex-col gap-2">
                            <button
                              onClick={() => handlePreviewForStudent(student.id)}
                              disabled={totalQuestions === 0}
                              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors shadow-sm"
                            >
                              <Printer size={18} />
                              PDF Önizle
                            </button>
                            <button
                              onClick={() => handleDownloadPDFForStudent(student.id)}
                              disabled={totalQuestions === 0 || generatingPDFForStudent === student.id}
                              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors shadow-sm"
                            >
                              {generatingPDFForStudent === student.id ? (
                                <>
                                  <Loader2 size={18} className="animate-spin" />
                                  <span>Oluşturuluyor...</span>
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
                      );
                    })}
                  </div>
                </div>

                {/* Tüm PDF'leri İndir Butonu - Sayfanın En Altı */}
                {students.length > 1 && (
                  <div className="mt-8 pt-8 border-t border-gray-200">
                    <div className="bg-gradient-to-r from-green-50 to-blue-50 p-6 rounded-xl border border-green-200">
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div>
                          <h3 className="text-lg font-bold text-gray-800 mb-1">Tüm Öğrenciler için PDF İndir</h3>
                          <p className="text-sm text-gray-600">
                            Tüm {students.length} öğrenci için PDF'leri tek seferde indirin
                          </p>
                        </div>
                        <button
                          onClick={handleDownloadAllPDFs}
                          disabled={students.length === 0 || isGeneratingAllPDFs || images.length === 0}
                          className="flex items-center justify-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors shadow-lg hover:shadow-xl min-w-[200px]"
                        >
                          {isGeneratingAllPDFs ? (
                            <>
                              <Loader2 size={20} className="animate-spin" />
                              <span>
                                PDF Oluşturuluyor... ({pdfGenerationProgress.current}/{pdfGenerationProgress.total})
                              </span>
                            </>
                          ) : (
                            <>
                              <Download size={20} />
                              <span>Tüm PDF'leri İndir</span>
                            </>
                          )}
                        </button>
                      </div>
                      {isGeneratingAllPDFs && pdfGenerationProgress.total > 0 && (
                        <div className="mt-4">
                          <div className="w-full bg-gray-200 rounded-full h-3">
                            <div 
                              className="bg-green-600 h-3 rounded-full transition-all duration-300"
                              style={{ width: `${(pdfGenerationProgress.current / pdfGenerationProgress.total) * 100}%` }}
                            ></div>
                          </div>
                          <p className="text-xs text-gray-600 mt-2 text-center">
                            {pdfGenerationProgress.current} / {pdfGenerationProgress.total} öğrenci için PDF oluşturuldu
                          </p>
                        </div>
                      )}
                      {images.length === 0 && (
                        <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                          <p className="text-xs text-amber-800 flex items-center gap-2">
                            <AlertCircle size={16} />
                            PDF oluşturmak için önce soruları yükleyin.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: PDF ÖNİZLEME (Web Görünümü) */}
        {activeTab === 'preview' && (
          <>
            
            {/* ÜST BUTONLAR - SABİT (STICKY) - SOL MENÜNÜN YANINDA */}
            <div className="sticky top-0 z-30 bg-gray-50 border-b border-gray-200 print:hidden shadow-sm">
              <div className="p-4 md:p-8 max-w-7xl mx-auto">
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                  <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
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
                </div>
              </div>
            </div>

            {/* İÇERİK ALANI */}
            <div className="p-4 md:p-8 max-w-7xl mx-auto flex flex-col items-center w-full">

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
                <div className="text-sm text-gray-500 mb-6 flex items-center gap-2 bg-blue-50 text-blue-700 p-3 rounded-lg w-full max-w-[210mm] print:hidden">
                  <AlertCircle size={18} className="shrink-0" /> 
                  <span>
                    <strong>İpucu:</strong> PDF indirme butonu ile fasikülünüzü direkt PDF dosyası olarak indirebilirsiniz. Yazdırma için "Yazdır" butonunu kullanabilirsiniz.
                  </span>
                </div>
              )}
            </div>
          </>
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
        w-full mx-auto bg-white shadow-2xl mb-12 origin-top
        print:shadow-none
      `}
        style={{ boxSizing: 'border-box' }}>
        {selectedStudentId && previewQuestions.length > 0 && (() => {
          // Soru boyutlarına göre temel sayfa başına soru sayısını belirle
          const baseQuestionsPerPage = calculateQuestionsPerPage(previewQuestions);
          
          // Dinamik sayfa oluşturma - boşlukları doldur
          const pages = [];
          let remainingQuestions = [...previewQuestions];
          
          while (remainingQuestions.length > 0) {
            const result = fillPageWithQuestions(remainingQuestions, baseQuestionsPerPage);
            pages.push(result.pageQuestions);
            remainingQuestions = result.remaining;
          }

          // Global soru indexi
          let globalQuestionIndex = 0;

          return (
            <div className="space-y-8">
              {pages.map((pageQuestions, pageIndex) => {
                const actualQuestionsPerPage = pageQuestions.length;
                // Bu sayfa için gap değerini hesapla (soru boyutlarına ve sayısına göre optimize)
                const gapValue = calculateGapForPage(pageQuestions, actualQuestionsPerPage);
                
                // Global index'i hesapla
                const currentPageStartIndex = globalQuestionIndex;
                globalQuestionIndex += actualQuestionsPerPage;
                
                return (
                  <div 
                    key={pageIndex}
                    className="w-[210mm] min-h-[297mm] mx-auto bg-white shadow-lg print:shadow-none print:break-after-page"
                    style={{ width: '210mm', maxWidth: '210mm', minWidth: '210mm', boxSizing: 'border-box' }}
                  >
                    <div className="p-[2mm] font-sans flex flex-col bg-white relative w-full box-border" style={{ width: '100%', maxWidth: '100%', minHeight: '297mm', height: '100%' }}>
                      
                      {/* ÜST BAŞLIK - REKABETÇİ DENEMELERİ - YENİ TASARIM */}
                      <div className="mb-4 relative" style={{ background: 'linear-gradient(135deg, #141b35 0%, #8e34e9 100%)', padding: '16px 20px', borderRadius: '8px', marginBottom: '16px' }}>
                        <div className="flex items-center justify-between">
                          <img src="/rbdlogo.png" alt="RBD Logo" style={{ height: '50px', width: 'auto', objectFit: 'contain', flexShrink: 0 }} />
                          <div className="text-center flex-1">
                            <h1 className="text-2xl font-black text-white tracking-wide uppercase mb-2" style={{ letterSpacing: '0.15em', textShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
                              REKABETÇİ DENEMELERİ
                            </h1>
                            <div className="w-32 h-1 bg-white mx-auto" style={{ opacity: 0.9, borderRadius: '2px' }}></div>
                          </div>
                          <div className="text-right" style={{ flexShrink: 0, width: 'auto' }}>
                            <div className="text-sm font-bold text-white uppercase" style={{ fontSize: '11px', letterSpacing: '0.1em', lineHeight: '1.4' }}>
                              Öğrenciye Özel<br/>Çalışma Fasikülü
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* ÖĞRENCİ BİLGİ BÖLÜMÜ - YENİ TASARIM */}
                      {design.showStudentName && (
                        <div className="mb-4" style={{ background: 'linear-gradient(135deg, rgba(142, 52, 233, 0.1) 0%, rgba(20, 27, 53, 0.1) 100%)', padding: '12px 16px', borderRadius: '8px', borderLeft: '4px solid #8e34e9', marginBottom: '16px' }}>
                          <div className="flex justify-between items-center">
                            <div>
                              <div className="text-xs uppercase font-semibold mb-1" style={{ color: '#8e34e9' }}>Öğrenci Adı Soyadı</div>
                              <div className="text-lg font-bold" style={{ color: '#141b35' }}>{students.find(s => s.id === selectedStudentId)?.name}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs uppercase font-semibold mb-1" style={{ color: '#8e34e9' }}>Tarih</div>
                              <div className="text-sm font-semibold" style={{ color: '#141b35' }}>{new Date().toLocaleDateString('tr-TR')}</div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* SORULAR - 2 SÜTUN (Dinamik soru sayısı ve boşluk) */}
                      <div className="flex-1 flex relative w-full box-border">
                        {/* ÜST ÇİZGİ */}
                        <div className="absolute left-1/2 top-0 w-[1px] transform -translate-x-1/2" style={{ backgroundColor: '#8e34e9', height: 'calc(50% - 120px)' }}></div>
                        {/* ORTA METİN */}
                        <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10" style={{ padding: '8px 4px', backgroundColor: 'white' }}>
                          <div className="text-xs font-bold uppercase" style={{ color: '#8e34e9', writingMode: 'vertical-rl', textOrientation: 'upright', fontSize: '9px', letterSpacing: '0.1em', lineHeight: '1.2' }}>
                            REKABETÇİ DENEMELERİ
                          </div>
                        </div>
                        {/* ALT ÇİZGİ */}
                        <div className="absolute left-1/2 bottom-0 w-[1px] transform -translate-x-1/2" style={{ backgroundColor: '#8e34e9', top: 'calc(50% + 120px)', height: 'calc(50% - 120px)' }}></div>
                        
                        {/* SOL SÜTUN */}
                        <div className="w-1/2 pr-[2mm] flex flex-col box-border flex-shrink-0" style={{ width: '50%', boxSizing: 'border-box', gap: gapValue }}>
                          {pageQuestions.slice(0, Math.ceil(actualQuestionsPerPage / 2)).map((q, idx) => {
                            const currentGlobalIndex = currentPageStartIndex + idx;
                            return (
                              <div key={currentGlobalIndex} className="break-inside-avoid flex items-start gap-2 w-full">
                                <span className="text-gray-900 font-bold text-sm flex-shrink-0">
                                  {currentGlobalIndex + 1})
                                </span>
                                <div className="flex-1">
                                  {q.src ? (
                                    <img src={q.src} alt={q.filename} className="max-w-full h-auto" />
                                  ) : (
                                    <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap font-mono pdf-text-content" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#1f2937' }}>
                                      {q.text || 'İçerik yok'}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        
                        {/* SAĞ SÜTUN */}
                        <div className="w-1/2 pl-[2mm] flex flex-col box-border flex-shrink-0" style={{ width: '50%', boxSizing: 'border-box', gap: gapValue }}>
                          {pageQuestions.slice(Math.ceil(actualQuestionsPerPage / 2), actualQuestionsPerPage).map((q, idx) => {
                            const currentGlobalIndex = currentPageStartIndex + Math.ceil(actualQuestionsPerPage / 2) + idx;
                            return (
                              <div key={currentGlobalIndex} className="break-inside-avoid flex items-start gap-2 w-full">
                                <span className="text-gray-900 font-bold text-sm flex-shrink-0">
                                  {currentGlobalIndex + 1})
                                </span>
                                <div className="flex-1">
                                  {q.src ? (
                                    <img src={q.src} alt={q.filename} className="max-w-full h-auto" />
                                  ) : (
                                    <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap font-mono pdf-text-content" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#1f2937' }}>
                                      {q.text || 'İçerik yok'}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                    {/* ALT BİLGİ - FOOTER - YENİ TASARIM */}
                    <div className="mt-auto relative" style={{ background: 'linear-gradient(135deg, #141b35 0%, #8e34e9 100%)', padding: '14px 20px', borderRadius: '8px', marginTop: 'auto' }}>
                      <div className="flex justify-between items-center text-xs">
                        <div className="text-left">
                          <span className="font-medium text-white" style={{ opacity: 0.95 }}>Bu fasikül </span>
                          <span className="font-bold text-white">{students.find(s => s.id === selectedStudentId)?.name}</span>
                          <span className="font-medium text-white" style={{ opacity: 0.95 }}> için özel olarak hazırlanmıştır.</span>
                        </div>
                        <div className="text-white font-bold uppercase tracking-wider ml-4" style={{ fontSize: '11px', letterSpacing: '0.2em', opacity: 0.95 }}>
                          Başarılar Dileriz
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
                );
              })}
            </div>
          );
        })()}
      </div>

    </div>
  );
}
