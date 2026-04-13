extern crate proc_macro;

use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, DeriveInput, Meta};

#[proc_macro_derive(Tool, attributes(tool))]
pub fn derive_tool(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = input.ident;

    let mut tool_name = String::new();
    let mut tool_desc = String::new();
    let mut tool_args = None;
    let mut requires_approval = false;

    // Parse #[tool(...)]
    for attr in input.attrs.iter().filter(|a| a.path().is_ident("tool")) {
        if let Meta::List(list) = &attr.meta {
            list.parse_nested_meta(|meta| {
                if meta.path.is_ident("name") {
                    let value = meta.value()?.parse::<syn::LitStr>()?;
                    tool_name = value.value();
                    Ok(())
                } else if meta.path.is_ident("description") {
                    let value = meta.value()?.parse::<syn::LitStr>()?;
                    tool_desc = value.value();
                    Ok(())
                } else if meta.path.is_ident("args") {
                    let lit = meta.value()?.parse::<syn::LitStr>()?;
                    let ty: syn::Type = syn::parse_str(&lit.value())?;
                    tool_args = Some(ty);
                    Ok(())
                } else if meta.path.is_ident("requires_approval") {
                    let value = meta.value()?.parse::<syn::LitBool>()?;
                    requires_approval = value.value();
                    Ok(())
                } else {
                    Err(meta.error("unsupported attribute"))
                }
            }).expect("Failed to parse tool attributes");
        }
    }

    if tool_name.is_empty() {
        panic!("Tool must specify #[tool(name = \"...\")]");
    }
    if tool_desc.is_empty() {
        panic!("Tool must specify #[tool(description = \"...\")]");
    }

    let schema_gen = match &tool_args {
        Some(ty) => quote! {
             serde_json::to_value(schemars::schema_for!(#ty)).unwrap_or(serde_json::json!({}))
        },
        None => quote! {
             serde_json::json!({
                 "type": "object",
                 "properties": {},
                 "required": []
             })
        },
    };

    let execution_block = match &tool_args {
        Some(ty) => quote! {
            let parsed_args: #ty = serde_json::from_value(args)
                .map_err(|e| format!("Invalid arguments: {}", e))?;
            self.run(parsed_args).await
        },
        None => quote! {
            self.run().await
        },
    };

    let expanded = quote! {
        #[async_trait::async_trait]
        impl Tool for #name {
            fn name(&self) -> String {
                #tool_name.to_string()
            }

            fn description(&self) -> String {
                #tool_desc.to_string()
            }

            fn schema(&self) -> serde_json::Value {
                #schema_gen
            }

            fn requires_approval(&self) -> bool {
                #requires_approval
            }

            // `execute` bridges the dynamic registry call to the typed static `run` method
            async fn execute(&self, args: serde_json::Value) -> Result<String, String> {
                #execution_block
            }
        }
    };

    TokenStream::from(expanded)
}
