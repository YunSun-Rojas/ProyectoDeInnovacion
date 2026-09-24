import React, { useState } from "react";
import { Eye, Camera, CheckCircle2, RefreshCw } from "lucide-react";

export default function Vision() {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);

  const handleSimulateScan = () => {
    setScanning(true);
    setResult(null);
    setTimeout(() => {
      setScanning(false);
      setResult({
        name: "Nvidia RTX 4070 Ti",
        confidence: "98.4%",
        detectedQty: 3
      });
    }, 2000);
  };

  return (
    <div style={{ padding: "32px 40px", background: "#FAF8F5", minHeight: "100vh" }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontFamily: "Oswald, sans-serif", fontSize: 32, fontWeight: 700, color: "#17171A" }}>
          Reconocimiento por Visión
        </h1>
        <p style={{ margin: "4px 0 0", fontFamily: "Inter, sans-serif", fontSize: 14, color: "#6E6C68" }}>
          Escaneo automático de paquetería e ingreso instantáneo de inventario.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Área de Cámara / Carga */}
        <div style={{ background: "#FFF", border: "2px dashed #E7E3DC", borderRadius: 12, padding: 40, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <Camera size={48} color="#6E6C68" style={{ marginBottom: 16 }} />
          <h3 style={{ margin: 0, fontFamily: "Inter, sans-serif", fontSize: 16 }}>Capturar o subir imagen</h3>
          <p style={{ fontSize: 13, color: "#6E6C68", marginBottom: 20 }}>Coloque el paquete frente a la cámara web o cargue una foto.</p>

          <button
            onClick={handleSimulateScan}
            disabled={scanning}
            style={{
              background: "#17171A",
              color: "#FFF",
              border: "none",
              padding: "12px 24px",
              borderRadius: 8,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8
            }}
          >
            {scanning ? <RefreshCw className="animate-spin" size={18} /> : <Eye size={18} />}
            {scanning ? "Analizando imagen..." : "Escanear Producto"}
          </button>
        </div>

        {/* Resultado de la Detección */}
        <div style={{ background: "#FFF", border: "1px solid #E7E3DC", borderRadius: 12, padding: 28 }}>
          <h3 style={{ margin: "0 0 20px 0", fontFamily: "Inter, sans-serif", fontSize: 18 }}>Resultado del Análisis</h3>

          {result ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#2F7D4F", background: "#E4F2E9", padding: "10px 14px", borderRadius: 8, fontWeight: 600, fontSize: 14 }}>
                <CheckCircle2 size={18} /> Identificación exitosa
              </div>

              <div>
                <span style={{ fontSize: 12, color: "#6E6C68", display: "block" }}>Producto Detectado</span>
                <span style={{ fontSize: 18, fontWeight: 600, color: "#17171A" }}>{result.name}</span>
              </div>

              <div style={{ display: "flex", gap: 20 }}>
                <div>
                  <span style={{ fontSize: 12, color: "#6E6C68", display: "block" }}>Confianza</span>
                  <span style={{ fontSize: 16, fontWeight: 600, color: "#17171A" }}>{result.confidence}</span>
                </div>
                <div>
                  <span style={{ fontSize: 12, color: "#6E6C68", display: "block" }}>Cantidad Contada</span>
                  <span style={{ fontSize: 16, fontWeight: 600, color: "#D62839" }}>{result.detectedQty} unids.</span>
                </div>
              </div>

              <button style={{ marginTop: 10, background: "#D62839", color: "#FFF", border: "none", padding: "12px", borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>
                Confirmar e Ingresar al Stock
              </button>
            </div>
          ) : (
            <p style={{ color: "#6E6C68", fontSize: 14 }}>Esperando captura para iniciar el procesamiento con IA...</p>
          )}
        </div>
      </div>
    </div>
  );
}