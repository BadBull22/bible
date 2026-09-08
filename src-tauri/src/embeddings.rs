use candle_core::{Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config, DTYPE};
use std::path::Path;
use tokenizers::{PaddingParams, Tokenizer};

/// Wraps all-MiniLM-L6-v2 (the standard, small sentence-embedding BERT variant) loaded
/// entirely from local files bundled with the app -- no network access, no Python.
/// Used both by the one-time corpus-embedding pipeline tool and, at runtime, to embed
/// the user's search query into the same 384-dim space for nearest-neighbor lookup.
pub struct Embedder {
    model: BertModel,
    tokenizer: Tokenizer,
    device: Device,
}

impl Embedder {
    pub fn load(model_dir: &Path) -> anyhow::Result<Self> {
        let device = Device::Cpu;
        let config_str = std::fs::read_to_string(model_dir.join("config.json"))?;
        let config: Config = serde_json::from_str(&config_str)?;
        let mut tokenizer = Tokenizer::from_file(model_dir.join("tokenizer.json"))
            .map_err(|e| anyhow::anyhow!("failed to load tokenizer: {e}"))?;
        tokenizer.with_padding(Some(PaddingParams::default()));
        let vb = unsafe {
            VarBuilder::from_mmaped_safetensors(&[model_dir.join("model.safetensors")], DTYPE, &device)?
        };
        let model = BertModel::load(vb, &config)?;
        Ok(Self { model, tokenizer, device })
    }

    /// Returns a single L2-normalized 384-dim embedding (mean-pooled over tokens).
    pub fn embed(&self, text: &str) -> anyhow::Result<Vec<f32>> {
        let encoding = self.tokenizer.encode(text, true).map_err(|e| anyhow::anyhow!("tokenize error: {e}"))?;
        let ids = encoding.get_ids();
        let token_ids = Tensor::new(ids, &self.device)?.unsqueeze(0)?;
        let token_type_ids = token_ids.zeros_like()?;
        let embeddings = self.model.forward(&token_ids, &token_type_ids, None)?;
        // mean pooling over the token dimension
        let (_n, n_tokens, _hidden) = embeddings.dims3()?;
        let pooled = (embeddings.sum(1)? / (n_tokens as f64))?;
        let norm = pooled.sqr()?.sum_keepdim(1)?.sqrt()?;
        let normalized = pooled.broadcast_div(&norm)?;
        Ok(normalized.squeeze(0)?.to_vec1::<f32>()?)
    }
}
