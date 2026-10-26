export default function Products({ products }) {
  return (
    <section id="product" className="home__section">
      <div className="home__container">
        <header className="home__head">
          <h2 className="heading-lg">Everything in one terminal</h2>
          <p className="fog">Three asset classes, one fast interface, and an AI analyst on call.</p>
        </header>
        <div className="products">
          {products.map(({ title, icon: Icon, text }) => (
            <article key={title} className="card product">
              <span className="product__icon">
                <Icon size={20} />
              </span>
              <h3 className="heading-sm">{title}</h3>
              <p className="fog">{text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
