import React, { useState, useCallback } from 'react';
import { db } from '../lib/firebase';
import { collection, addDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Camera, X, Loader2, Check, AlertCircle, Upload } from 'lucide-react';
import { motion } from 'motion/react';
import { useDropzone } from 'react-dropzone';
import { AnalysisResult } from '../types';
import { GoogleGenAI } from '@google/genai';

interface MealLoggerProps {
  userId: string;
  onClose: () => void;
  onLogged: () => void;
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default function MealLogger({ userId, onClose, onLogged }: MealLoggerProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    let selectedFile = acceptedFiles[0];
    console.log('File selected:', selectedFile); // Request Step 1
    
    if (selectedFile) {
      setError(null);

      // Check if file is HEIC or HEIF
      // Note: iOS sometimes auto-converts HEIC to JPEG on upload but keeps the .heic filename.
      // If the type is already image/jpeg, we don't need to convert it.
      const isHeic = (selectedFile.type === 'image/heic' || selectedFile.type === 'image/heif') || 
                     ((!selectedFile.type || selectedFile.type === '') && 
                      (selectedFile.name.toLowerCase().endsWith('.heic') || selectedFile.name.toLowerCase().endsWith('.heif')));

      if (isHeic) {
        try {
          // Show loading state while converting
          setConverting(true);
          const heic2any = (await import('heic2any')).default;
          const convertedBlob = await heic2any({
            blob: selectedFile,
            toType: 'image/jpeg',
            quality: 0.8
          });

          // Replace file with converted JPEG blob
          const blobArray = Array.isArray(convertedBlob) ? convertedBlob : [convertedBlob];
          selectedFile = new File(blobArray, 'photo.jpg', { type: 'image/jpeg' });
        } catch (err: any) {
          console.error('HEIC conversion failed:', err);
          // If the library throws ERR_LIBHEIF, the file likely isn't a valid HEIC file to begin with
          // (e.g., iOS already converted it to JPEG before handing it to the browser).
          // Fall back gracefully to using the original selectedFile instead of outright failing.
          console.log('Falling back to direct file read...');
        } finally {
          setConverting(false);
        }
      }

      setFile(selectedFile);
      
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        console.log('Base64 result:', result?.substring(0, 50)); // Request Step 2
        setPreview(result);
      };
      reader.readAsDataURL(selectedFile);
      
      setError(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 
      'image/*': ['.jpeg', '.jpg', '.png', '.webp'],
      'image/heic': ['.heic'],
      'image/heif': ['.heif']
    },
    multiple: false,
  } as any);

  const analyzeImage = async () => {
    if (!file) return;

    setAnalyzing(true);
    setError(null);

    try {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not configured.');
      }

      // Convert file to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.readAsDataURL(file);
      });

      const base64 = await base64Promise;

      const prompt = "Identify the food in this image. Provide a JSON response with: name (concise string), calories (estimated number), protein (grams number), carbs (grams number), fats (grams number). ONLY return the JSON object.";

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{
          parts: [
            { text: prompt },
            { 
              inlineData: { 
                data: base64, 
                mimeType: file.type || 'image/jpeg' 
              } 
            }
          ]
        }]
      });

      const content = response.text;
      if (!content) throw new Error('Empty response from Gemini AI');

      // Extract JSON if it's wrapped in markdown code blocks
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const foodData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

      if (!foodData) {
        throw new Error('Could not parse Gemini response: ' + content);
      }

      setResult(foodData);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error communicating with Gemini AI');
    } finally {
      setAnalyzing(false);
    }
  };

  const confirmLog = async () => {
    if (!result || !file) return;

    try {
      console.log('File selected:', file);

      // Compress the image safely reading directly from the File Blob
      const compressImage = (): Promise<string> => {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = 400;
              canvas.height = 400;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                // Maintain aspect ratio while sizing to fill 400x400
                const aspect = img.width / img.height;
                let drawWidth, drawHeight, offsetX, offsetY;
                if (aspect > 1) {
                  drawHeight = 400;
                  drawWidth = 400 * aspect;
                  offsetX = -(drawWidth - 400) / 2;
                  offsetY = 0;
                } else {
                  drawWidth = 400;
                  drawHeight = 400 / aspect;
                  offsetX = 0;
                  offsetY = -(drawHeight - 400) / 2;
                }
                ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
                const compressed = canvas.toDataURL('image/jpeg', 0.7);
                console.log('Base64 result:', compressed.substring(0, 50));
                resolve(compressed);
              } else {
                resolve(dataUrl); // fallback
              }
            };
            img.src = dataUrl;
          };
          reader.readAsDataURL(file);
        });
      };

      const compressedBase64 = await compressImage();

      const mealData = {
        ...result,
        timestamp: Timestamp.now(),
        createdAt: serverTimestamp(),
        imageUrl: compressedBase64, // Saved persistently
      };

      await addDoc(collection(db, 'users', userId, 'meals'), mealData);
      
      console.log('Saved meal image data exists:', !!mealData.imageUrl);

      try {
        // Safe check for quota limits just in case
        localStorage.setItem('test_quota', JSON.stringify({ test: 'data' }));
        localStorage.removeItem('test_quota');
      } catch(e) {
        console.error('localStorage is FULL:', e);
      }

      onLogged();
      onClose();
    } catch (err) {
      console.error('Error saving meal:', err);
      setError('Failed to save meal record');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center backdrop-blur-sm"
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        className="w-full max-w-md"
      >
        <Card className="rounded-t-[32px] sm:rounded-[32px] border-[#E8E6E0] bg-white shadow-2xl overflow-hidden p-0">
          <CardHeader className="flex flex-row items-center justify-between p-8 pb-4">
            <CardTitle className="text-2xl font-serif font-bold text-[#2D2D2A]">Log Meal</CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full hover:bg-[#F1F3EE]">
              <X className="h-6 w-6 text-[#8E8D8A]" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-8 p-8 pt-0">
            {!preview ? (
              <div
                {...getRootProps()}
                className={`flex aspect-square cursor-pointer flex-col items-center justify-center rounded-[32px] border-2 border-dashed transition-all duration-300 ${
                  isDragActive ? 'border-[#5A6E4B] bg-[#F1F3EE]' : 'border-[#E8E6E0] bg-[#F8F7F2] hover:border-[#5A6E4B] hover:bg-[#F1F3EE]'
                }`}
              >
                <input {...getInputProps({ capture: 'environment' })} />
                
                {converting ? (
                  <div className="flex flex-col items-center justify-center space-y-4">
                    <Loader2 className="h-10 w-10 animate-spin text-[#5A6E4B] stroke-[3]" />
                    <p className="font-bold text-[#2D2D2A]">Converting iPhone photo...</p>
                    <p className="text-xs text-[#8E8D8A]">This takes just a moment</p>
                  </div>
                ) : (
                  <>
                    <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-[#E8E6E0] mb-6">
                      <Camera className="h-10 w-10 text-[#5A6E4B]" />
                    </div>
                    <p className="text-xl font-bold text-[#2D2D2A]">Snap or Upload</p>
                    <p className="text-sm text-[#8E8D8A] mt-1">Gemini AI will identify your meal</p>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-8">
                <div className="relative w-full aspect-square min-h-[250px] overflow-hidden rounded-[32px] group ring-1 ring-[#E8E6E0] bg-[#F8F7F2]">
                  <img 
                    id="image-preview"
                    src={preview} 
                    alt="food"
                    className="transition-transform group-hover:scale-105 duration-700" 
                    style={{ 
                      display: 'block', 
                      width: '100%', 
                      height: '100%', 
                      objectFit: 'cover',
                      borderRadius: '16px'
                    }} 
                  />
                  <Button
                    size="icon"
                    className="absolute right-6 top-6 h-10 w-10 rounded-full bg-black/40 text-white backdrop-blur-lg hover:bg-black/60 transition-all z-10"
                    onClick={() => { setFile(null); setPreview(null); setResult(null); }}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>

                {analyzing ? (
                  <div className="flex flex-col items-center justify-center py-12 space-y-6">
                    <div className="relative h-16 w-16">
                      <Loader2 className="h-16 w-16 animate-spin text-[#5A6E4B] stroke-[3]" />
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-bold text-[#2D2D2A]">Gemini is identifying...</p>
                      <p className="text-sm text-[#8E8D8A]">Analyzing ingredients and nutrition</p>
                    </div>
                  </div>
                ) : result ? (
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-6">
                    <div className="rounded-[24px] bg-[#F8F7F2] p-8 border border-[#E8E6E0]">
                      <h4 className="text-3xl font-serif font-bold mb-6 flex items-center gap-3 text-[#2D2D2A]">
                        {result.name}
                        <span className="text-[12px] bg-[#5A6E4B] text-white px-2 py-0.5 rounded-lg font-black uppercase tracking-widest">Gemini Result</span>
                      </h4>
                      <div className="grid grid-cols-2 gap-8">
                        <div className="space-y-1">
                          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#8E8D8A]">Calories</p>
                          <p className="text-4xl font-bold text-[#2D2D2A]">{result.calories} <span className="text-sm font-normal text-[#8E8D8A]">kcal</span></p>
                        </div>
                        <div className="grid gap-3">
                          <div className="flex justify-between items-center text-sm border-b border-[#E8E6E0] pb-1">
                            <span className="text-[#8E8D8A] font-medium">Protein</span>
                            <span className="font-bold text-[#2D2D2A]">{result.protein}g</span>
                          </div>
                          <div className="flex justify-between items-center text-sm border-b border-[#E8E6E0] pb-1">
                            <span className="text-[#8E8D8A] font-medium">Carbs</span>
                            <span className="font-bold text-[#2D2D2A]">{result.carbs}g</span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-[#8E8D8A] font-medium">Fats</span>
                            <span className="font-bold text-[#2D2D2A]">{result.fats}g</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <Button className="w-full h-16 bg-[#5A6E4B] text-xl font-bold rounded-[20px] shadow-lg hover:bg-[#4A5E3B] transition-all active:scale-[0.98]" onClick={confirmLog}>
                      <Check className="mr-3 h-6 w-6" /> Log this meal
                    </Button>
                  </motion.div>
                ) : (
                  <div className="space-y-6">
                    {error && (
                      <div className="flex items-center gap-3 rounded-[20px] bg-[#E57373]/10 p-5 text-sm font-medium text-[#E57373]">
                        <AlertCircle className="h-6 w-6 shrink-0" />
                        <p>{error}</p>
                      </div>
                    )}
                    <Button className="w-full h-16 bg-[#5A6E4B] text-xl font-bold rounded-[20px] shadow-lg hover:bg-[#4A5E3B] transition-all active:scale-[0.98]" onClick={analyzeImage}>
                      <Upload className="mr-3 h-6 w-6" /> Analyze with Gemini AI
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
